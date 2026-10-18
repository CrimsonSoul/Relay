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

/** Resolves null when no reference source is available, so nothing can be called unreferenced. */
async function referencedKnowledgeChecksums(): Promise<Set<string> | null> {
  const config = getAppConfig()?.load();
  let records: unknown[];
  if (config?.mode === 'server') {
    const pb = getPbClient();
    if (!pb) return null;
    records = await pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getFullList({
      fields: 'checksum',
      requestKey: null,
    });
  } else if (config?.mode === 'client') {
    const cache = getOfflineCache();
    if (!cache) return null;
    records = cache.readCollection(KNOWLEDGE_DOCUMENTS_COLLECTION);
  } else {
    return null;
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
    // PDF orphans also need to age past a grace period, so an unknown reference set only lets the
    // byte budget and long-unused files go.
    getKnowledgePdfService()?.cleanup(checksums ?? new Set()),
    // Covers are deleted as soon as they are unreferenced, so they wait for a known reference set.
    checksums ? getKnowledgeCoverService()?.cleanup(checksums) : undefined,
  ]);
}
