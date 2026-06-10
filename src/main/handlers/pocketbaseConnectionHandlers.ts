import { ipcMain } from 'electron';
import PocketBase from 'pocketbase';
import { IPC_CHANNELS, type PbConnectionResult } from '@shared/ipc';
import { isAllowedRelayServerUrl } from '@shared/urlSecurity';
import type { AppConfig } from '../config/AppConfig';
import type { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { loggers } from '../logger';

const PB_BOOTSTRAP_AUTH_TIMEOUT_MS = 15_000;
const PB_BOOTSTRAP_AUTH_ATTEMPTS = 4;
const PB_BOOTSTRAP_AUTH_RETRY_MS = 750;
const APP_USER_EMAIL = 'relay@relay.app';
const SUPERUSER_EMAIL = 'admin@relay.app';

class PbAuthTimeoutError extends Error {
  constructor() {
    super('PocketBase authentication timed out');
    this.name = 'PbAuthTimeoutError';
  }
}

type AuthFailure = {
  error: 'auth-failed' | 'pb-unavailable';
  timedOut: boolean;
  originalError: unknown;
};

type AuthAttemptResult =
  | { ok: true; result: PbConnectionResult }
  | { ok: false; failure: AuthFailure };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPbUrl(
  config: ReturnType<AppConfig['load']>,
  pbProcess: PocketBaseProcess | null,
): string | null {
  if (pbProcess?.isRunning()) {
    return pbProcess.getLocalUrl();
  }

  if (config?.mode === 'client' && typeof config.serverUrl === 'string' && config.serverUrl) {
    if (!isAllowedRelayServerUrl(config.serverUrl, config.allowInsecureHttp === true)) {
      return null;
    }
    return config.serverUrl;
  }

  return null;
}

function isPbUnavailableError(error: unknown): boolean {
  if (error instanceof PbAuthTimeoutError) {
    return true;
  }

  if (error instanceof TypeError) {
    return error.message.includes('fetch');
  }

  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  if ('name' in error && (error as { name?: string }).name === 'AbortError') {
    return true;
  }

  return 'status' in error && (error as { status?: number }).status === 0;
}

function getPbConnectionResult(pbUrl: string, pb: PocketBase): PbConnectionResult {
  return {
    ok: true,
    connection: {
      pbUrl,
      auth: {
        token: pb.authStore.token,
        record: pb.authStore.record ?? null,
      },
    },
  };
}

function isServerModeConfig(
  config: ReturnType<AppConfig['load']>,
): config is Extract<ReturnType<AppConfig['load']>, { mode: 'server' }> {
  return config?.mode === 'server';
}

function getPbConnectionContext(
  getAppConfig: () => AppConfig | null,
  getPbProcess: () => PocketBaseProcess | null,
):
  | { ok: true; config: ReturnType<AppConfig['load']>; pbUrl: string }
  | { ok: false; result: PbConnectionResult } {
  const appConfig = getAppConfig();
  const config = appConfig?.load();

  if (!config) {
    return { ok: false, result: { ok: false, error: 'not-configured' } };
  }

  const pbUrl = getPbUrl(config, getPbProcess());
  if (!pbUrl) {
    return {
      ok: false,
      result: { ok: false, error: config.mode === 'server' ? 'pb-unavailable' : 'invalid-config' },
    };
  }

  return { ok: true, config, pbUrl };
}

async function withPbAuthTimeout<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const authTimeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PB_BOOTSTRAP_AUTH_TIMEOUT_MS);

  try {
    return await action(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new PbAuthTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(authTimeout);
  }
}

function toAuthFailure(error: unknown): AuthFailure {
  return {
    error: isPbUnavailableError(error) ? 'pb-unavailable' : 'auth-failed',
    timedOut: error instanceof PbAuthTimeoutError,
    originalError: error,
  };
}

async function authenticatePbConnectionOnce(
  config: ReturnType<AppConfig['load']>,
  pbUrl: string,
  secret: string,
): Promise<AuthAttemptResult> {
  const pb = new PocketBase(pbUrl);

  try {
    await withPbAuthTimeout(async (signal) => {
      await pb.collection('_pb_users_auth_').authWithPassword(APP_USER_EMAIL, secret, {
        signal,
        requestKey: null,
      });
    });
    return { ok: true, result: getPbConnectionResult(pbUrl, pb) };
  } catch (error) {
    if (isServerModeConfig(config) && !isPbUnavailableError(error)) {
      try {
        await withPbAuthTimeout(async (signal) => {
          await pb.collection('_superusers').authWithPassword(SUPERUSER_EMAIL, secret, {
            signal,
            requestKey: null,
          });
        });

        loggers.pocketbase.warn(
          'PocketBase app-user authentication failed; superuser credentials validated but were not returned to the renderer',
          { pbUrl },
        );
        return { ok: false, failure: toAuthFailure(error) };
      } catch (fallbackError) {
        return { ok: false, failure: toAuthFailure(fallbackError) };
      }
    }

    return { ok: false, failure: toAuthFailure(error) };
  }
}

async function authenticatePbConnection(
  config: ReturnType<AppConfig['load']>,
  pbUrl: string,
  secret: string,
  logMessage: string,
): Promise<PbConnectionResult> {
  return authenticatePbConnectionWithRetries(config, pbUrl, secret, logMessage);
}

async function authenticatePbConnectionWithRetries(
  config: ReturnType<AppConfig['load']>,
  pbUrl: string,
  secret: string,
  logMessage: string,
): Promise<PbConnectionResult> {
  let lastFailure: AuthFailure | null = null;

  for (let attempt = 1; attempt <= PB_BOOTSTRAP_AUTH_ATTEMPTS; attempt++) {
    const attemptResult = await authenticatePbConnectionOnce(config, pbUrl, secret);
    if (attemptResult.ok) {
      if (attempt > 1) {
        loggers.pocketbase.info('PocketBase authentication recovered after retry', {
          attempt,
          pbUrl,
        });
      }
      return attemptResult.result;
    }

    lastFailure = attemptResult.failure;
    loggers.pocketbase.warn(logMessage, {
      attempt,
      attempts: PB_BOOTSTRAP_AUTH_ATTEMPTS,
      error: lastFailure.originalError,
      pbUrl,
    });

    if (lastFailure.timedOut || attempt === PB_BOOTSTRAP_AUTH_ATTEMPTS) {
      break;
    }

    await delay(PB_BOOTSTRAP_AUTH_RETRY_MS);
  }

  return { ok: false, error: lastFailure?.error ?? 'auth-failed' };
}

export function setupPocketbaseConnectionHandlers(
  getAppConfig: () => AppConfig | null,
  getPbProcess: () => PocketBaseProcess | null,
): void {
  ipcMain.handle(IPC_CHANNELS.PB_GET_CONNECTION, async (): Promise<PbConnectionResult> => {
    const context = getPbConnectionContext(getAppConfig, getPbProcess);
    if (!context.ok) {
      return context.result;
    }

    return authenticatePbConnection(
      context.config,
      context.pbUrl,
      context.config.secret,
      'Failed to bootstrap PocketBase connection',
    );
  });

  ipcMain.handle(IPC_CHANNELS.PB_REFRESH_CONNECTION, async (): Promise<PbConnectionResult> => {
    const context = getPbConnectionContext(getAppConfig, getPbProcess);
    if (!context.ok) {
      return context.result;
    }

    return authenticatePbConnection(
      context.config,
      context.pbUrl,
      context.config.secret,
      'Failed to refresh PocketBase connection',
    );
  });
}
