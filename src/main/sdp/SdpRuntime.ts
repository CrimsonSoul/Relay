import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type PocketBase from 'pocketbase';
import type { AppConfig } from '../config/AppConfig';
import {
  SDP_DISCOVERY_COLLECTION,
  SDP_DISCOVERY_ID,
  type SdpBackend,
  type SdpServerCommand,
  type SdpServerView,
} from '@shared/sdpAccount';
import { SdpBroker } from './SdpBroker';
import { SdpServerStore } from './SdpServerStore';
import { SdpGatewayClient } from './SdpGatewayClient';

type Context = { getConfig: () => AppConfig | null; getPb: () => PocketBase | null };
let context: Context | undefined;
let closed = false;
let broker: SdpBroker | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let published = '';
let publishing: Promise<void> | undefined;
let republish = false;
const localId = `desktop:${randomUUID()}`;
let remote: SdpGatewayClient | undefined;
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
        await publishSdpDiscoveryOnce();
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
  async invoke(command) {
    const config = context?.getConfig()?.load();
    if (config?.mode === 'server') {
      const current = getSdpBroker();
      return current
        ? current.invoke(localId, command)
        : { view: { configured: false, status: 'disconnected' } };
    }
    if (config?.mode !== 'client') return { view: { configured: false, status: 'disconnected' } };
    remote ??= new SdpGatewayClient(() => {
      const current = context?.getConfig()?.load();
      const pb = context?.getPb();
      if (current?.mode !== 'client' || !pb) throw new Error('Relay connection unavailable.');
      return { config: current, pb };
    });
    return remote.invoke(command);
  },
};
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
