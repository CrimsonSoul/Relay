import { KNOWLEDGE_DOCUMENTS_COLLECTION, isKnowledgeChecksum } from '@shared/knowledge';
import {
  getAppConfig,
  getKnowledgePdfService,
  getKnowledgeCoverService,
  getOfflineCache,
  getPbClient,
  setKnowledgePdfService,
  setKnowledgeCoverService,
} from '../app/appState';
import { KnowledgeCoverService } from './KnowledgeCoverService';
import { KnowledgePdfService } from './KnowledgePdfService';

export function initializeKnowledgePdfService(configDataDir: string): KnowledgePdfService {
  const service = new KnowledgePdfService({
    configDataDir,
    getConfig: () => getAppConfig()?.load() ?? null,
    getPbClient,
  });
  setKnowledgePdfService(service);
  setKnowledgeCoverService(
    new KnowledgeCoverService({
      configDataDir,
      getConfig: () => getAppConfig()?.load() ?? null,
      getPbClient,
      getPdfService: getKnowledgePdfService,
    }),
  );
  return service;
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
  const checksums = await referencedKnowledgeChecksums();
  await Promise.all([
    getKnowledgePdfService()?.cleanup(checksums),
    getKnowledgeCoverService()?.cleanup(checksums),
  ]);
}
