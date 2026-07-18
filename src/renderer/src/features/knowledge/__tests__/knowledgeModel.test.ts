import { describe, expect, it } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  buildKnowledgeLibrary,
  findKnowledgeDocument,
  knowledgeDocumentMatches,
} from '../knowledgeModel';

function document(
  overrides: Partial<KnowledgeDocumentRecord> & Pick<KnowledgeDocumentRecord, 'id' | 'title'>,
): KnowledgeDocumentRecord {
  return {
    id: overrides.id,
    sourceKey: `${overrides.id}.pdf`,
    category: 'General',
    title: overrides.title,
    displayTitle: overrides.title,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: '',
    publishedByName: '',
    publishedAt: '2026-07-14T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    fileName: `${overrides.title}.pdf`,
    pdf: `${overrides.title}.pdf`,
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 2,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('knowledgeModel', () => {
  it('groups and naturally sorts documents with General first', () => {
    const library = buildKnowledgeLibrary([
      document({ id: '3', title: 'Reset 10', category: 'Operations' }),
      document({ id: '1', title: 'Welcome', category: 'General' }),
      document({ id: '2', title: 'Reset 2', category: 'Operations' }),
      document({ id: '4', title: 'Escalation', category: 'Applications' }),
    ]);

    expect(library.map((group) => group.category)).toEqual([
      'General',
      'Applications',
      'Operations',
    ]);
    expect(library[2]?.documents.map((entry) => entry.title)).toEqual(['Reset 2', 'Reset 10']);
  });

  it('matches category, file name, title, and nested heading text without changing outline', () => {
    const entry = document({
      id: '1',
      title: 'Payment recovery',
      category: 'Store systems',
      fileName: 'payments-runbook.pdf',
      outline: [{ id: 'h1', label: 'Restart the lane service', level: 1, pageIndex: 4, top: 710 }],
    });

    expect(knowledgeDocumentMatches(entry, 'store')).toBe(true);
    expect(knowledgeDocumentMatches(entry, 'runbook')).toBe(true);
    expect(knowledgeDocumentMatches(entry, 'PAYMENT')).toBe(true);
    expect(knowledgeDocumentMatches(entry, 'lane service')).toBe(true);
    expect(knowledgeDocumentMatches(entry, 'printer')).toBe(false);
    expect(buildKnowledgeLibrary([entry], 'lane')[0]?.documents[0]?.outline).toEqual(entry.outline);
  });

  it('falls back only before selection and reports a missing selected document', () => {
    const first = document({ id: 'first', title: 'First' });
    const second = document({ id: 'second', title: 'Second' });
    const library = buildKnowledgeLibrary([second, first]);

    expect(findKnowledgeDocument(library, 'second')?.id).toBe('second');
    expect(findKnowledgeDocument(library, null)?.id).toBe('first');
    expect(findKnowledgeDocument(library, 'missing')).toBeNull();
    expect(findKnowledgeDocument([], 'missing')).toBeNull();
  });

  it('uses display titles and excludes trashed documents from the reader model', () => {
    const active = document({
      id: 'active',
      title: 'Legacy title',
      displayTitle: 'Current title',
      fileName: 'current.pdf',
    });
    const trashed = document({
      id: 'trashed',
      title: 'Hidden',
      lifecycleState: 'trashed',
      trashedByAccountId: 'account-1',
      trashedByName: 'Ryan Bledsoe',
      trashedAt: '2026-07-15T12:00:00.000Z',
    });

    const library = buildKnowledgeLibrary([trashed, active], 'current');
    expect(library[0]?.documents.map(({ id }) => id)).toEqual(['active']);
    expect(knowledgeDocumentMatches(active, 'legacy')).toBe(false);
  });
});
