import type PocketBase from 'pocketbase';
import { KNOWLEDGE_DOCUMENTS_COLLECTION, type KnowledgeIndexStatus } from '@shared/knowledge';

const EMPTY_STATUS: KnowledgeIndexStatus = {
  state: 'idle',
  documentCount: 0,
  categoryCount: 0,
  lastIndexedAt: null,
};

type KnowledgeStatusRecord = {
  category?: unknown;
  indexedAt?: unknown;
  lifecycleState?: unknown;
};

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
}

export class KnowledgeIndexStatusService {
  constructor(private readonly getPbClient: () => PocketBase | null) {}

  async getStatus(): Promise<KnowledgeIndexStatus> {
    const pb = this.getPbClient();
    if (!pb) return { ...EMPTY_STATUS };

    try {
      const records = await pb
        .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
        .getFullList<KnowledgeStatusRecord>({
          fields: 'category,indexedAt,lifecycleState',
          requestKey: null,
        });
      const active = records.filter(({ lifecycleState }) => lifecycleState !== 'trashed');
      const categories = new Set(
        active.flatMap(({ category }) =>
          typeof category === 'string' && category.trim() ? [category.trim()] : [],
        ),
      );
      const timestamps = active
        .flatMap(({ indexedAt }) => (validTimestamp(indexedAt) ? [indexedAt] : []))
        .toSorted((left, right) => left.localeCompare(right));

      return {
        state: 'idle',
        documentCount: active.length,
        categoryCount: categories.size,
        lastIndexedAt: timestamps.at(-1) ?? null,
      };
    } catch {
      return {
        ...EMPTY_STATUS,
        state: 'error',
        message: 'Knowledge library status unavailable',
      };
    }
  }
}
