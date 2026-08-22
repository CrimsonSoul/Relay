import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_CATEGORIES_COLLECTION,
  KNOWLEDGE_CATEGORY_MIGRATION_VERSION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
  KNOWLEDGE_UNCATEGORIZED_SYSTEM_KEY,
  knowledgeCategoryKey,
  normalizeKnowledgeCategoryName,
} from '@shared/knowledge';

type MigrationState = {
  id: string;
  categoryMigrationVersion?: number;
};

type StoredCategory = {
  id: string;
  name: string;
  normalizedName?: string;
  sortOrder?: number;
  systemKey?: string;
};

type LegacyDocument = {
  id: string;
  category?: string;
  categoryId?: string;
  documentType?: string;
};

const FALLBACK_NAME = 'Uncategorized';

async function readMigrationState(pb: PocketBase): Promise<MigrationState | null> {
  const result = await pb
    .collection(KNOWLEDGE_LIBRARY_STATE_COLLECTION)
    .getList<MigrationState>(1, 2, { filter: 'key="primary"', requestKey: null });
  if (result.totalItems !== 1 || result.items.length !== 1) return null;
  return result.items[0] ?? null;
}

function legacyCategoryName(document: LegacyDocument): string {
  return typeof document.category === 'string' && document.category.trim()
    ? normalizeKnowledgeCategoryName(document.category)
    : FALLBACK_NAME;
}

function desiredCategoryNames(documents: LegacyDocument[]): string[] {
  const names = new Map<string, string>();
  for (const document of documents) {
    const name = legacyCategoryName(document);
    const key = knowledgeCategoryKey(name);
    if (!names.has(key)) names.set(key, name);
  }
  names.set(knowledgeCategoryKey(FALLBACK_NAME), FALLBACK_NAME);
  return [...names.values()].toSorted((left, right) => left.localeCompare(right, 'en'));
}

async function ensureCategories(
  pb: PocketBase,
  documents: LegacyDocument[],
): Promise<Map<string, StoredCategory>> {
  const collection = pb.collection(KNOWLEDGE_CATEGORIES_COLLECTION);
  const existing = await collection.getFullList<StoredCategory>({
    sort: 'sortOrder,name',
    requestKey: null,
  });
  const byKey = new Map(
    existing
      .filter(
        (category) =>
          typeof category.id === 'string' &&
          typeof category.name === 'string' &&
          category.name.trim().length > 0,
      )
      .map((category) => [
        category.normalizedName || knowledgeCategoryKey(category.name),
        category,
      ]),
  );

  for (const [index, name] of desiredCategoryNames(documents).entries()) {
    const normalizedName = knowledgeCategoryKey(name);
    if (byKey.has(normalizedName)) continue;
    const saved = await collection.create<StoredCategory>(
      {
        name,
        normalizedName,
        sortOrder: (index + 1) * 100,
        systemKey:
          normalizedName === knowledgeCategoryKey(FALLBACK_NAME)
            ? KNOWLEDGE_UNCATEGORIZED_SYSTEM_KEY
            : '',
        revision: 1,
      },
      { requestKey: null },
    );
    byKey.set(normalizedName, saved);
  }
  return byKey;
}

export async function migrateKnowledgeCategories(pb: PocketBase): Promise<void> {
  const state = await readMigrationState(pb);
  if (!state || (state.categoryMigrationVersion ?? 0) >= KNOWLEDGE_CATEGORY_MIGRATION_VERSION) {
    return;
  }

  const documentCollection = pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION);
  const rawDocuments = await documentCollection.getFullList<LegacyDocument>({
    sort: 'category,title,fileName',
    requestKey: null,
  });
  const documents = rawDocuments.filter(
    (document) => typeof document.id === 'string' && typeof document.category === 'string',
  );
  const categories = await ensureCategories(pb, documents);
  const fallback = categories.get(knowledgeCategoryKey(FALLBACK_NAME));
  if (!fallback) throw new Error('Knowledge fallback category was not created.');

  for (const document of documents) {
    const name = legacyCategoryName(document);
    const category = categories.get(knowledgeCategoryKey(name)) ?? fallback;
    const documentType = document.documentType === 'cheatsheet' ? 'cheatsheet' : 'sop';
    if (
      document.categoryId === category.id &&
      document.category === category.name &&
      document.documentType === documentType
    ) {
      continue;
    }
    await documentCollection.update(
      document.id,
      { categoryId: category.id, category: category.name, documentType },
      { requestKey: null },
    );
  }

  await pb
    .collection(KNOWLEDGE_LIBRARY_STATE_COLLECTION)
    .update(
      state.id,
      { categoryMigrationVersion: KNOWLEDGE_CATEGORY_MIGRATION_VERSION },
      { requestKey: null },
    );
}
