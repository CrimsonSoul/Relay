import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  isKnowledgeChecksum,
  type KnowledgeIndexStatus,
} from '@shared/knowledge';
import {
  getAppConfig,
  getKnowledgeBaseManager,
  getKnowledgePdfService,
  getOfflineCache,
  getPbClient,
  setKnowledgeBaseManager,
  setKnowledgePdfService,
} from '../app/appState';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { KnowledgeBaseManager } from './KnowledgeBaseManager';
import { ManagedKnowledgeMigration } from './ManagedKnowledgeMigration';
import { KnowledgePdfService } from './KnowledgePdfService';

export function initializeKnowledgePdfService(configDataDir: string): KnowledgePdfService {
  const service = new KnowledgePdfService({
    configDataDir,
    getConfig: () => getAppConfig()?.load() ?? null,
    getPbClient,
  });
  setKnowledgePdfService(service);
  return service;
}

export async function stopKnowledgeBaseManager(): Promise<void> {
  const manager = getKnowledgeBaseManager();
  setKnowledgeBaseManager(null);
  await manager?.stop();
}

export async function startKnowledgeBaseManager(configDataDir: string): Promise<void> {
  await stopKnowledgeBaseManager();
  const config = getAppConfig()?.load();
  if (config?.mode !== 'server' || !getPbClient()) return;

  const manager = new KnowledgeBaseManager({
    root: join(configDataDir, 'knowledge-base'),
    getPbClient,
    broadcastStatus: (status: KnowledgeIndexStatus) =>
      broadcastToAllWindows(IPC_CHANNELS.KNOWLEDGE_INDEX_STATUS_CHANGED, status),
  });
  setKnowledgeBaseManager(manager);
  try {
    const migration = new ManagedKnowledgeMigration({
      pb: getPbClient()!,
      root: join(configDataDir, 'knowledge-base'),
      reconcileLegacy: async () => {
        await manager.reconcile();
        return { healthy: manager.getStatus().state !== 'error' };
      },
    });
    await migration.run();
    await manager.stop();
    setKnowledgeBaseManager(null);
  } catch (error) {
    setKnowledgeBaseManager(null);
    await manager.stop();
    throw error;
  }
}

async function referencedKnowledgeChecksums(): Promise<Set<string>> {
  const config = getAppConfig()?.load();
  let records: unknown[] = [];
  if (config?.mode === 'server') {
    const pb = getPbClient();
    if (pb) {
      records = await pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getFullList({
        fields: 'checksum',
        requestKey: null,
      });
    }
  } else if (config?.mode === 'client') {
    records = getOfflineCache()?.readCollection(KNOWLEDGE_DOCUMENTS_COLLECTION) ?? [];
  }

  return new Set(
    records.flatMap((record) => {
      if (!record || typeof record !== 'object' || !('checksum' in record)) return [];
      const checksum = (record as { checksum: unknown }).checksum;
      return isKnowledgeChecksum(checksum) ? [checksum] : [];
    }),
  );
}

export async function cleanupKnowledgePdfCache(): Promise<void> {
  const service = getKnowledgePdfService();
  if (!service) return;
  await service.cleanup(await referencedKnowledgeChecksums());
}
