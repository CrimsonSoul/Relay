import PocketBase from 'pocketbase';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';
import {
  getAppConfig,
  getKnowledgeSearchService,
  getOfflineCache,
  getPbClient,
  setKnowledgeSearchService,
} from '../app/appState';
import { loggers } from '../logger';
import { KnowledgeSearchService } from './KnowledgeSearchService';

function knowledgeLogger(): typeof loggers.main {
  return (loggers as unknown as { knowledge?: typeof loggers.main }).knowledge ?? loggers.main;
}

let lifecycleTail: Promise<void> = Promise.resolve();

function serializeLifecycle(operation: () => Promise<void>): Promise<void> {
  const next = lifecycleTail.then(operation, operation);
  lifecycleTail = next.catch(() => undefined);
  return next;
}

async function stopCurrentService(): Promise<void> {
  const service = getKnowledgeSearchService();
  setKnowledgeSearchService(null);
  if (!service) return;
  try {
    await service.dispose();
  } catch (error) {
    knowledgeLogger().warn('Enhanced Wiki search shutdown failed', { error });
  }
}

async function restartRuntime(): Promise<void> {
  await stopCurrentService();
  const service = new KnowledgeSearchService({ cache: getOfflineCache() });
  setKnowledgeSearchService(service);

  try {
    const config = getAppConfig()?.load();
    if (!config) return;
    if (config.mode === 'server') {
      await service.start(getPbClient());
      return;
    }
    const pb = new PocketBase(config.serverUrl);
    await service.start(null);
    await pb
      .collection('_pb_users_auth_')
      .authWithPassword(RELAY_APP_USER_EMAIL, config.secret, { requestKey: null });
    await service.connect(pb);
  } catch (error) {
    knowledgeLogger().warn('Enhanced Wiki search is unavailable', { error });
  }
}

export function restartKnowledgeSearchRuntime(): Promise<void> {
  return serializeLifecycle(restartRuntime);
}

export function stopKnowledgeSearchRuntime(): Promise<void> {
  return serializeLifecycle(stopCurrentService);
}
