import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryMode,
} from '@shared/knowledge';
import { scanKnowledgeRoot, type KnowledgeSourceScan } from './knowledgePathSafety';

type KnowledgeLibraryStateRecord = {
  id: string;
  key: 'primary';
  mode: KnowledgeLibraryMode;
  transitionedAt: string;
  transitionedByOperatorId: string;
  safeError: string;
  revision: number;
};

type ManagedKnowledgeMigrationOptions = {
  pb: PocketBase;
  root: string;
  now?: () => number;
  scanLegacy?: (root: string) => Promise<KnowledgeSourceScan>;
  reconcileLegacy: () => Promise<{ healthy: boolean }>;
};

export class ManagedKnowledgeMigration {
  private readonly pb: PocketBase;
  private readonly root: string;
  private readonly now: () => number;
  private readonly scanLegacy: (root: string) => Promise<KnowledgeSourceScan>;
  private readonly reconcileLegacy: () => Promise<{ healthy: boolean }>;

  constructor(options: ManagedKnowledgeMigrationOptions) {
    this.pb = options.pb;
    this.root = options.root;
    this.now = options.now ?? Date.now;
    this.scanLegacy = options.scanLegacy ?? scanKnowledgeRoot;
    this.reconcileLegacy = options.reconcileLegacy;
  }

  async run(): Promise<KnowledgeLibraryStateRecord> {
    let state = await this.readState();
    if (state?.mode === 'managed' || state?.mode === 'recovery-required') return state;

    const existing = await this.readDocuments();
    const scan = await this.scanLegacy(this.root);
    if (!scan.healthy) {
      if (existing.length === 0) return this.transition(state, 'managed');
      return this.transition(state, 'recovery-required', '', 'Legacy source is unavailable.');
    }

    state = await this.transition(state, 'migrating');
    try {
      const reconciliation = await this.reconcileLegacy();
      if (!reconciliation.healthy) {
        return this.transition(
          state,
          'recovery-required',
          '',
          'Legacy reconciliation did not complete.',
        );
      }
      await this.backfill(await this.readDocuments());
      return this.transition(state, 'managed');
    } catch {
      return this.transition(state, 'recovery-required', '', 'Legacy reconciliation failed.');
    }
  }

  async adoptCurrentLibrary(operatorId: string): Promise<KnowledgeLibraryStateRecord> {
    const state = await this.readState();
    if (!state || state.mode !== 'recovery-required') {
      throw new Error('Knowledge library adoption is not available.');
    }
    await this.backfill(await this.readDocuments());
    return this.transition(state, 'managed', operatorId);
  }

  private async readState(): Promise<KnowledgeLibraryStateRecord | null> {
    try {
      return await this.pb
        .collection(KNOWLEDGE_LIBRARY_STATE_COLLECTION)
        .getFirstListItem<KnowledgeLibraryStateRecord>('key="primary"', { requestKey: null });
    } catch {
      return null;
    }
  }

  private readDocuments(): Promise<KnowledgeDocumentRecord[]> {
    return this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .getFullList<KnowledgeDocumentRecord>({ requestKey: null });
  }

  private async backfill(documents: KnowledgeDocumentRecord[]): Promise<void> {
    const collection = this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION);
    for (const document of documents) {
      if (
        document.lifecycleState === 'active' &&
        document.displayTitle &&
        Number.isInteger(document.revision) &&
        document.revision >= 1
      ) {
        continue;
      }
      await collection.update(
        document.id,
        {
          lifecycleState: 'active',
          displayTitle: document.displayTitle || document.title,
          revision:
            Number.isInteger(document.revision) && document.revision >= 1 ? document.revision : 1,
          publishedByOperatorId: document.publishedByOperatorId || '',
          publishedByName: document.publishedByName || '',
          publishedAt:
            document.publishedAt || document.indexedAt || document.created || this.timestamp(),
          trashedByOperatorId: '',
          trashedByName: '',
          trashedAt: '',
        },
        { requestKey: null },
      );
    }
  }

  private async transition(
    state: KnowledgeLibraryStateRecord | null,
    mode: KnowledgeLibraryMode,
    operatorId = '',
    safeError = '',
  ): Promise<KnowledgeLibraryStateRecord> {
    const value = {
      key: 'primary' as const,
      mode,
      transitionedAt: this.timestamp(),
      transitionedByOperatorId: operatorId,
      safeError,
      revision: (state?.revision ?? 0) + 1,
    };
    const collection = this.pb.collection(KNOWLEDGE_LIBRARY_STATE_COLLECTION);
    return state
      ? collection.update<KnowledgeLibraryStateRecord>(state.id, value, { requestKey: null })
      : collection.create<KnowledgeLibraryStateRecord>(value, { requestKey: null });
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }
}
