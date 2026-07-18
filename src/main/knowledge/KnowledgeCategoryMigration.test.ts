import { describe, expect, it, vi } from 'vitest';
import { migrateKnowledgeCategories } from './KnowledgeCategoryMigration';

describe('migrateKnowledgeCategories', () => {
  it('creates stable case-insensitive categories and backfills legacy documents once', async () => {
    const categories: Array<Record<string, unknown>> = [];
    const documents: Array<Record<string, unknown>> = [
      { id: 'doc-access-a', category: 'Access', title: 'A', fileName: 'a.pdf' },
      { id: 'doc-access-b', category: ' access ', title: 'B', fileName: 'b.pdf' },
      { id: 'doc-network', category: 'Network', title: 'C', fileName: 'c.pdf' },
      { id: 'doc-empty', category: '', title: 'D', fileName: 'd.pdf' },
    ];
    const state = {
      id: 'state-primary',
      key: 'primary',
      mode: 'managed',
      categoryMigrationVersion: 0,
    };
    const categoryCreate = vi.fn(async (record: Record<string, unknown>) => {
      const saved = { id: `category-${categories.length + 1}`, ...record };
      categories.push(saved);
      return saved;
    });
    const documentUpdate = vi.fn(async (id: string, patch: Record<string, unknown>) => {
      Object.assign(documents.find((document) => document.id === id)!, patch);
      return documents.find((document) => document.id === id);
    });
    const stateUpdate = vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      Object.assign(state, patch);
      return state;
    });
    const pb = {
      collection: (name: string) => {
        if (name === 'knowledge_categories') {
          return { getFullList: async () => categories, create: categoryCreate };
        }
        if (name === 'knowledge_documents') {
          return { getFullList: async () => documents, update: documentUpdate };
        }
        return {
          getList: async () => ({ totalItems: 1, items: [state] }),
          update: stateUpdate,
        };
      },
    };

    await migrateKnowledgeCategories(pb as never);

    expect(categories.map(({ normalizedName }) => normalizedName)).toEqual([
      'access',
      'network',
      'uncategorized',
    ]);
    expect(categories.filter(({ normalizedName }) => normalizedName === 'access')).toHaveLength(1);
    expect(
      categories.find(({ normalizedName }) => normalizedName === 'uncategorized'),
    ).toMatchObject({
      name: 'Uncategorized',
      systemKey: 'uncategorized',
    });
    expect(documents.every(({ categoryId }) => typeof categoryId === 'string')).toBe(true);
    expect(documents.every(({ documentType }) => documentType === 'sop')).toBe(true);
    expect(state.categoryMigrationVersion).toBe(1);

    categoryCreate.mockClear();
    documentUpdate.mockClear();
    stateUpdate.mockClear();
    await migrateKnowledgeCategories(pb as never);

    expect(categoryCreate).not.toHaveBeenCalled();
    expect(documentUpdate).not.toHaveBeenCalled();
    expect(stateUpdate).not.toHaveBeenCalled();
  });
});
