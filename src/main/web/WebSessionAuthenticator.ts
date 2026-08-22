import { networkInterfaces } from 'node:os';
import PocketBase from 'pocketbase';
import type { PbAuthSession } from '@shared/ipc';
import { WEB_RUNTIME } from '@shared/runtime';
import type { AppConfig, ServerConfig } from '../config/AppConfig';
import { authenticateRelayAppUser as authenticateRelayAppUserDefault } from '../handlers/pocketbaseConnectionHandlers';
import type { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import type { WebSessionCreateInput } from './WebSessionStore';

type SessionPocketBase = {
  authStore: {
    token: string;
    record: unknown;
    save(token: string, record?: unknown): void;
    clear(): void;
  };
  collection(name: string): {
    authRefresh(options?: { requestKey?: null }): Promise<unknown>;
  };
};

type WebSessionAuthenticatorOptions = {
  getAppConfig: () => AppConfig | null;
  getPbProcess: () => PocketBaseProcess | null;
  getLanAddress?: () => string | undefined;
  authenticateRelayAppUser?: typeof authenticateRelayAppUserDefault;
  createPocketBase?: (url: string) => SessionPocketBase;
};

function preferredLanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((entry) => entry.family === 'IPv4' && !entry.internal);
    if (address) return address.address;
  }
  return undefined;
}

function formatHost(address: string): string {
  return address.includes(':') ? `[${address}]` : address;
}

function publicPocketBaseUrl(address: string, port: number): string {
  return ['http', '://', formatHost(address), ':', String(port)].join('');
}

// The caller supplies the already validated Host of the request, but this stays defensive:
// anything that is not a bare hostname or address must never reach a generated URL.
function safeBrowserHost(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9._:-]{1,255}$/u.test(value) ? value.toLowerCase() : null;
}

function sessionAuth(pb: SessionPocketBase): PbAuthSession {
  const record =
    pb.authStore.record && typeof pb.authStore.record === 'object'
      ? (pb.authStore.record as Record<string, unknown>)
      : null;
  return { token: pb.authStore.token, record };
}

type SessionInputOptions = {
  config: ServerConfig;
  lanAddress: string;
  // Host this browser actually reached Relay Web on. PocketBase has to be advertised on the same
  // host, otherwise a multi-homed server hands out an origin the page's CSP will not connect to.
  browserHost: string;
  localPbUrl: string;
  initialAuth: PbAuthSession;
  createPocketBase: (url: string) => SessionPocketBase;
};

function createSessionInput({
  config,
  lanAddress,
  browserHost,
  localPbUrl,
  initialAuth,
  createPocketBase,
}: SessionInputOptions): WebSessionCreateInput {
  const pb = createPocketBase(localPbUrl);
  pb.authStore.save(initialAuth.token, initialAuth.record);
  return {
    pbUrl: publicPocketBaseUrl(browserHost, config.port),
    auth: initialAuth,
    publicConfig: {
      mode: 'server',
      port: config.port,
      bindHost: config.bindHost,
      lanIp: lanAddress,
      ...(config.web ? { web: { ...config.web } } : {}),
    },
    runtime: WEB_RUNTIME,
    refresh: async () => {
      await pb.collection('_pb_users_auth_').authRefresh({ requestKey: null });
      return sessionAuth(pb);
    },
    dispose: () => pb.authStore.clear(),
  };
}

export function createWebSessionAuthenticator({
  getAppConfig,
  getPbProcess,
  getLanAddress = preferredLanAddress,
  authenticateRelayAppUser = authenticateRelayAppUserDefault,
  createPocketBase = (url) => new PocketBase(url) as SessionPocketBase,
}: WebSessionAuthenticatorOptions): (
  passphrase: string,
  browserHost?: string,
) => Promise<WebSessionCreateInput | null> {
  return async (passphrase: string, browserHost?: string) => {
    const config = getAppConfig()?.load();
    const pbProcess = getPbProcess();
    const lanAddress = getLanAddress();
    if (config?.mode !== 'server' || !pbProcess?.isRunning() || !lanAddress) return null;
    const localPbUrl = pbProcess.getLocalUrl();
    const result = await authenticateRelayAppUser(
      config,
      localPbUrl,
      passphrase,
      'Relay Web login failed',
      { allowServerSuperuserFallback: false },
    );
    if (!result.ok) return null;
    return createSessionInput({
      config,
      lanAddress,
      browserHost: safeBrowserHost(browserHost) ?? lanAddress,
      localPbUrl,
      initialAuth: result.connection.auth,
      createPocketBase,
    });
  };
}
