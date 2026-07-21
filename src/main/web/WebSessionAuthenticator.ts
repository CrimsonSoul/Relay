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

function sessionAuth(pb: SessionPocketBase): PbAuthSession {
  const record =
    pb.authStore.record && typeof pb.authStore.record === 'object'
      ? (pb.authStore.record as Record<string, unknown>)
      : null;
  return { token: pb.authStore.token, record };
}

function createSessionInput(
  config: ServerConfig,
  lanAddress: string,
  localPbUrl: string,
  initialAuth: PbAuthSession,
  createPocketBase: (url: string) => SessionPocketBase,
): WebSessionCreateInput {
  const pb = createPocketBase(localPbUrl);
  pb.authStore.save(initialAuth.token, initialAuth.record);
  return {
    pbUrl: publicPocketBaseUrl(lanAddress, config.port),
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
}: WebSessionAuthenticatorOptions): (passphrase: string) => Promise<WebSessionCreateInput | null> {
  return async (passphrase: string) => {
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
    );
    if (!result.ok) return null;
    return createSessionInput(
      config,
      lanAddress,
      localPbUrl,
      result.connection.auth,
      createPocketBase,
    );
  };
}
