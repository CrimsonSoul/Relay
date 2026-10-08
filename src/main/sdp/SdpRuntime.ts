import { app, safeStorage } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import PocketBase, { BaseAuthStore } from 'pocketbase';
import type { AppConfig, ClientConfig } from '../config/AppConfig';
import {
  SDP_DEVICE_PATTERN,
  SDP_DISCOVERY_COLLECTION,
  SDP_DISCOVERY_ID,
  type SdpBackend,
  type SdpServerCommand,
  type SdpServerView,
} from '@shared/sdpAccount';
import { SdpBroker } from './SdpBroker';
import { SdpServerStore } from './SdpServerStore';
import { SdpGatewayClient } from './SdpGatewayClient';
import { authenticateRelayAppUserShared } from '../pocketbase/RelayAppUserAuthCoordinator';

type Context = { getConfig: () => AppConfig | null; getPb: () => PocketBase | null };
let context: Context | undefined;
let closed = false;
let broker: SdpBroker | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let published = '';
let publishing: Promise<void> | undefined;
let republish = false;
const localId = `desktop:${randomUUID()}`;
/** The server computer's own desktop; gateway devices are named `client:<key>`. */
const LOCAL_DEVICE = 'desktop';
let clientDevice: string | undefined;
let remote: SdpGatewayClient | undefined;
let remoteConnection: { owner: string; pb: PocketBase; signedInAt: number } | undefined;
// A server without SDP discovery also answers 404, so a dropped token waits before signing in again.
const REMOTE_SIGN_IN_INTERVAL_MS = 60_000;
export function initializeSdpRuntime(value: Context): void {
  context = value;
  closed = false;
  timer = setInterval(() => {
    void publishSdpDiscovery().catch(() => undefined);
  }, 15_000);
  timer.unref();
  app.once('before-quit', () => {
    closed = true;
    clearInterval(timer);
    broker?.dispose();
    broker = undefined;
  });
}
export function getSdpBroker(): SdpBroker | null {
  if (closed) return null;
  if (context?.getConfig()?.load()?.mode !== 'server') {
    broker?.dispose();
    broker = undefined;
    return null;
  }
  broker ??= new SdpBroker(
    new SdpServerStore(join(app.getPath('userData'), 'sdp-server'), {
      isEncryptionAvailable: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    }),
  );
  return broker;
}
/** Coalesces publishes; a call made while one is in flight runs again with the latest settings. */
function publishSdpDiscovery(): Promise<void> {
  if (publishing) {
    republish = true;
    return publishing;
  }
  const run = async (): Promise<void> => {
    try {
      do {
        republish = false;
        await publishSdpDiscoveryOnce(); // NOSONAR - coalescing loop: each publish must finish before the next reads newer settings.
      } while (republish);
    } finally {
      publishing = undefined;
    }
  };
  publishing = run();
  return publishing;
}
async function publishSdpDiscoveryOnce(): Promise<void> {
  const config = context?.getConfig()?.load();
  const pb = context?.getPb();
  if (config?.mode !== 'server') {
    getSdpBroker();
    published = '';
    return;
  }
  if (!pb?.authStore.isValid || pb.authStore.record?.collectionName !== '_superusers') return;
  const settings = getSdpBroker()?.store.settings();
  const body = {
    enabled: !!settings && config.web?.enabled === true,
    gatewayPort: config.web?.port ?? 8091,
    revision: settings?.revision ?? '',
  };
  const fingerprint = `${pb.baseURL}:${JSON.stringify(body)}`;
  if (published === fingerprint) return;
  const records = pb.collection(SDP_DISCOVERY_COLLECTION);
  try {
    await records.update(SDP_DISCOVERY_ID, body, { requestKey: null });
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    await records.create({ id: SDP_DISCOVERY_ID, ...body }, { requestKey: null });
  }
  published = fingerprint;
}
export const sdpBackend: SdpBackend = {
  async invoke(command, options) {
    const config = context?.getConfig()?.load();
    if (config?.mode === 'server') {
      const current = getSdpBroker();
      const device = options?.keepSignIn ? undefined : LOCAL_DEVICE;
      return current
        ? current.invoke(localId, command, device)
        : { view: { configured: false, status: 'disconnected' } };
    }
    if (config?.mode !== 'client') return { view: { configured: false, status: 'disconnected' } };
    remote ??= new SdpGatewayClient(remoteContext, fetch, sdpClientDevice);
    return remote.invoke(command, options);
  },
};
/**
 * This client desktop's random device key, kept in its user data. The server remembers the
 * desktop's SDP sign-in under it, so reopening Relay does not need a new sign-in.
 */
function sdpClientDevice(): string {
  if (clientDevice) return clientDevice;
  const path = join(app.getPath('userData'), 'sdp-device');
  try {
    const saved = readFileSync(path, 'utf8').trim();
    if (SDP_DEVICE_PATTERN.test(saved)) clientDevice = saved;
  } catch {
    // First use: a new key is created below.
  }
  if (!clientDevice) {
    clientDevice = randomBytes(32).toString('base64url');
    try {
      writeFileSync(path, clientDevice, { mode: 0o600 });
    } catch {
      // Unsaved, the key still lasts until Relay closes.
    }
  }
  return clientDevice;
}
/** Client mode has no main-process server connection, so SDP signs in as the Relay app user itself. */
async function remoteContext(): Promise<{ config: ClientConfig; pb: PocketBase }> {
  const config = context?.getConfig()?.load();
  if (config?.mode !== 'client') throw new Error('Relay connection unavailable.');
  const owner = `${config.serverUrl}\0${config.secret}`;
  if (remoteConnection?.owner !== owner)
    remoteConnection = {
      owner,
      pb: new PocketBase(config.serverUrl, new BaseAuthStore()),
      signedInAt: 0,
    };
  const connection = remoteConnection;
  if (!connection.pb.authStore.isValid) {
    if (Date.now() - connection.signedInAt < REMOTE_SIGN_IN_INTERVAL_MS)
      throw new Error('Relay connection unavailable.');
    await authenticateRelayAppUserShared(connection.pb, config.serverUrl, config.secret);
    connection.signedInAt = Date.now();
  }
  return { config, pb: connection.pb };
}
export async function sdpServerCommand(command: SdpServerCommand): Promise<SdpServerView> {
  const config = context?.getConfig()?.load();
  if (config?.mode !== 'server') throw new Error('Configure SDP on the Relay server computer.');
  const current = getSdpBroker();
  if (!current) throw new Error('SDP is unavailable while Relay closes.');
  if (command.action !== 'status') {
    current.store.save(
      command.action === 'save' ? command.client : null,
      command.action === 'save' ? command.cacheMinutes : 60,
      command.expectedRevision,
    );
    current.reset();
    published = '';
  }
  await publishSdpDiscovery();
  const settings = current.store.settings();
  return {
    configured: !!settings,
    revision: settings?.revision ?? '',
    cacheMinutes: settings?.cacheMinutes ?? 60,
    gatewayEnabled: config.web?.enabled === true,
    gatewayPort: config.web?.port ?? 8091,
  };
}
