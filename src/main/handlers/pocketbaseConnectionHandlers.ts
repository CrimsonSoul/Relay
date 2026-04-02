import { ipcMain } from 'electron';
import PocketBase from 'pocketbase';
import { IPC_CHANNELS, type PbConnectionResult } from '@shared/ipc';
import type { AppConfig } from '../config/AppConfig';
import type { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import { loggers } from '../logger';

const PB_BOOTSTRAP_AUTH_TIMEOUT_MS = 15_000;

function getPbUrl(
  config: ReturnType<AppConfig['load']>,
  pbProcess: PocketBaseProcess | null,
): string | null {
  if (pbProcess?.isRunning()) {
    return pbProcess.getLocalUrl();
  }

  if (config?.mode === 'client' && typeof config.serverUrl === 'string' && config.serverUrl) {
    return config.serverUrl;
  }

  return null;
}

function isPbUnavailableError(error: unknown): boolean {
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
        record: (pb.authStore.record as Record<string, unknown> | null) ?? null,
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
  const authTimeout = setTimeout(() => controller.abort(), PB_BOOTSTRAP_AUTH_TIMEOUT_MS);

  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(authTimeout);
  }
}

async function authenticatePbConnection(
  config: ReturnType<AppConfig['load']>,
  pbUrl: string,
  secret: string,
  logMessage: string,
): Promise<PbConnectionResult> {
  const pb = new PocketBase(pbUrl);

  try {
    await withPbAuthTimeout(async (signal) => {
      await pb.collection('_pb_users_auth_').authWithPassword('relay@relay.app', secret, {
        signal,
        requestKey: null,
      });
    });

    return getPbConnectionResult(pbUrl, pb);
  } catch (error) {
    if (isServerModeConfig(config) && !isPbUnavailableError(error)) {
      try {
        await withPbAuthTimeout(async (signal) => {
          await pb.collection('_superusers').authWithPassword('admin@relay.app', secret, {
            signal,
            requestKey: null,
          });
        });

        return getPbConnectionResult(pbUrl, pb);
      } catch (fallbackError) {
        const errorCode = isPbUnavailableError(fallbackError) ? 'pb-unavailable' : 'auth-failed';
        loggers.pocketbase.warn(logMessage, {
          error: fallbackError,
          pbUrl,
          authMethod: 'superuser-fallback',
          initialAuthError: error,
        });
        return { ok: false, error: errorCode };
      }
    }

    const errorCode = isPbUnavailableError(error) ? 'pb-unavailable' : 'auth-failed';
    loggers.pocketbase.warn(logMessage, { error, pbUrl });
    return { ok: false, error: errorCode };
  }
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
