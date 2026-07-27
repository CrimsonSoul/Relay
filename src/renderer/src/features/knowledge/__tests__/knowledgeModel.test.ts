import { describe, expect, it } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  buildKnowledgeLibrary,
  buildKnowledgeCatalog,
  buildLocalKnowledgeSearchResults,
  findKnowledgeDocument,
  knowledgeDocumentMatches,
} from '../knowledgeModel';

function document(
  overrides: Partial<KnowledgeDocumentRecord> & Pick<KnowledgeDocumentRecord, 'id' | 'title'>,
): KnowledgeDocumentRecord {
  const { id, title } = overrides;
  return {
    sourceKey: `${id}.pdf`,
    category: 'General',
    categoryId: null,
    documentType: 'sop',
    displayTitle: title,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: '',
    publishedByName: '',
    publishedAt: '2026-07-14T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    fileName: `${title}.pdf`,
    pdf: `${title}.pdf`,
    cover: null,
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 2,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-14T12:00:00.000Z',
    searchIndexError: null,
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

  it('builds the M3 catalog with ordered SOP groups and cheatsheets', () => {
    const categories = [
      {
        id: 'cat-network',
        name: 'Network',
        normalizedName: 'network',
        sortOrder: 200,
        systemKey: '' as const,
        revision: 1,
        created: '2026-07-14T12:00:00.000Z',
        updated: '2026-07-14T12:00:00.000Z',
      },
      {
        id: 'cat-access',
        name: 'Access',
        normalizedName: 'access',
        sortOrder: 100,
        systemKey: '' as const,
        revision: 1,
        created: '2026-07-14T12:00:00.000Z',
        updated: '2026-07-14T12:00:00.000Z',
      },
    ];
    const catalog = buildKnowledgeCatalog({
      documents: [
        document({
          id: 'network-sop',
          title: 'Router recovery',
          category: 'Network',
          categoryId: 'cat-network',
        }),
        document({
          id: 'access-sop',
          title: 'Oracle access',
          category: 'Access',
          categoryId: 'cat-access',
        }),
        document({
          id: 'quick',
          title: 'Escalation numbers',
          category: 'Access',
          categoryId: 'cat-access',
          documentType: 'cheatsheet',
          updated: '2026-07-18T12:00:00.000Z',
        }),
      ],
      categories,
      query: '',
      categoryId: 'all',
      documentType: 'all',
      sort: 'recent',
    });

    expect(catalog).not.toHaveProperty('recent');
    expect(catalog.sopGroups.map(({ category }) => category.name)).toEqual(['Access', 'Network']);
    expect(catalog.cheatsheets.map(({ id }) => id)).toEqual(['quick']);
    expect(catalog.total).toBe(3);
  });

  it('builds exact page-aware fallback rows from document metadata and outline headings', () => {
    const entry = document({
      id: 'oracle',
      title: 'Oracle recovery',
      displayTitle: 'Oracle recovery guide',
      category: 'Access',
      fileName: 'oracle-failover.pdf',
      outline: [
        { id: 'overview', label: 'Overview', level: 1, pageIndex: 0, top: 700 },
        { id: 'failover', label: 'Failover procedure', level: 1, pageIndex: 6, top: 680 },
      ],
    });

    expect(buildLocalKnowledgeSearchResults([entry], 'oracle')).toEqual([
      expect.objectContaining({
        id: 'local-oracle-document',
        documentId: 'oracle',
        headingId: null,
        heading: null,
        pageIndex: 0,
        matchKind: 'exact',
      }),
    ]);
    expect(buildLocalKnowledgeSearchResults([entry], 'failover')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: 'oracle',
          headingId: 'failover',
          heading: 'Failover procedure',
          pageIndex: 6,
          matchKind: 'exact',
        }),
      ]),
    );
  });

  it('keeps fallback excerpts bounded and excludes inactive documents', () => {
    const active = document({
      id: 'active',
      title: 'Recovery',
      displayTitle: 'Recovery '.repeat(25).trim(),
      category: 'Operations '.repeat(12).trim(),
      fileName: `${'recovery-'.repeat(20)}guide.pdf`,
    });
    const trashed = document({ id: 'trashed', title: 'Recovery', lifecycleState: 'trashed' });

    const results = buildLocalKnowledgeSearchResults([active, trashed], 'recovery');

    expect(results).toHaveLength(1);
    expect(results[0]?.documentId).toBe('active');
    expect(results[0]?.excerpt.length).toBeLessThanOrEqual(280);
  });
});
