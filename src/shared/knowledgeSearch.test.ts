import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_SEARCH_INDEX_VERSION,
  KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS,
  boundedSearchLimit,
  isKnowledgeSearchQueryEligible,
  normalizeKnowledgeSearchChunkRecord,
  normalizeKnowledgeSearchQuery,
  normalizeKnowledgeSearchResult,
  normalizeKnowledgeSearchTextWithRanges,
  normalizeKnowledgeSearchRequest,
  normalizeKnowledgeSearchResponse,
} from './knowledgeSearch';

const validChunk = {
  id: 'chunk1',
  documentId: 'document1',
  checksum: 'a'.repeat(64),
  pageNumber: 1,
  passageNumber: 1,
  headingId: null,
  heading: null,
  text: 'RF failover procedure',
  normalizedText: 'rf failover procedure',
  normalizedStart: 0,
  normalizedEnd: 21,
  indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
  indexedAt: '2026-07-19T18:00:00.000Z',
  created: '2026-07-19T18:00:00.000Z',
  updated: '2026-07-19T18:00:00.000Z',
};

const validResult = {
  id: 'chunk1',
  documentId: 'document1',
  checksum: 'a'.repeat(64),
  title: 'Runbook',
  fileName: 'Runbook.pdf',
  category: 'Operations',
  categoryId: null,
  documentType: 'sop',
  headingId: null,
  heading: null,
  pageIndex: 0,
  passageNumber: 1,
  excerpt: 'RF failover procedure',
  matchKind: 'exact',
  highlightText: 'failover',
  normalizedStart: 0,
  normalizedEnd: 8,
  score: 1,
};

describe('knowledge search contracts', () => {
  it('normalizes compatibility characters, composed Unicode, case, and whitespace', () => {
    expect(normalizeKnowledgeSearchQuery('  ＲＦ\nFailover  ')).toBe('rf failover');
    expect(normalizeKnowledgeSearchQuery('Cafe\u0301')).toBe('café');
  });

  it('keeps normalized source ranges aligned while trimming collapsed whitespace', () => {
    const normalized = normalizeKnowledgeSearchTextWithRanges('  Cafe\u0301\n  RF  ');

    expect(normalized.text).toBe('café rf');
    expect(normalized.sourceRanges).toHaveLength(normalized.text.length);
    expect(normalized.sourceRanges[3]).toEqual({ start: 5, end: 7 });
    expect(normalized.sourceRanges.at(-1)).toEqual({ start: 11, end: 12 });
  });

  it('rejects empty and function-word-only enhanced queries', () => {
    expect(isKnowledgeSearchQueryEligible('the and of')).toBe(false);
    expect(isKnowledgeSearchQueryEligible('the failover procedure')).toBe(true);
  });

  it('uses Unicode code points for the request query bound', () => {
    expect(
      normalizeKnowledgeSearchRequest({
        requestId: 'request1',
        query: `r${'😀'.repeat(KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS - 1)}`,
        scope: { kind: 'all' },
        categoryId: null,
        documentType: null,
        limit: 20,
      }),
    ).not.toBeNull();
    expect(
      normalizeKnowledgeSearchRequest({
        requestId: 'request1',
        query: `r${'😀'.repeat(KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS)}`,
        scope: { kind: 'all' },
        categoryId: null,
        documentType: null,
        limit: 20,
      }),
    ).toBeNull();
  });

  it('bounds both raw and NFKC-normalized request queries without expansion bypasses', () => {
    const expandingCompatibilityQuery = '\uFDFA'.repeat(8);

    expect([...expandingCompatibilityQuery]).toHaveLength(8);
    expect([...normalizeKnowledgeSearchQuery(expandingCompatibilityQuery)].length).toBeGreaterThan(
      KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS,
    );
    expect(
      normalizeKnowledgeSearchRequest({
        requestId: 'request1',
        query: expandingCompatibilityQuery,
        scope: { kind: 'all' },
        categoryId: null,
        documentType: null,
        limit: 20,
      }),
    ).toBeNull();
  });

  it('accepts zero-based page offsets and one-based page and passage numbers', () => {
    expect(
      normalizeKnowledgeSearchChunkRecord({
        id: 'chunk1',
        documentId: 'document1',
        checksum: 'a'.repeat(64),
        pageNumber: 1,
        passageNumber: 1,
        headingId: '',
        heading: '',
        text: 'RF failover procedure',
        normalizedText: 'rf failover procedure',
        normalizedStart: 0,
        normalizedEnd: 21,
        indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
        indexedAt: '2026-07-19T18:00:00.000Z',
        created: '2026-07-19T18:00:00.000Z',
        updated: '2026-07-19T18:00:00.000Z',
      }),
    ).toMatchObject({ pageNumber: 1, passageNumber: 1, normalizedStart: 0 });
  });

  it('accepts canonical chunk timestamps and rejects impossible calendar dates', () => {
    expect(normalizeKnowledgeSearchChunkRecord(validChunk)).not.toBeNull();
    expect(
      normalizeKnowledgeSearchChunkRecord({
        ...validChunk,
        indexedAt: '2026-02-30T18:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('rejects unsafe integer chunk coordinates and result offsets', () => {
    const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;

    expect(
      normalizeKnowledgeSearchChunkRecord({ ...validChunk, pageNumber: unsafeInteger }),
    ).toBeNull();
    expect(
      normalizeKnowledgeSearchChunkRecord({ ...validChunk, passageNumber: unsafeInteger }),
    ).toBeNull();
    expect(
      normalizeKnowledgeSearchChunkRecord({
        ...validChunk,
        normalizedStart: unsafeInteger,
        normalizedEnd: unsafeInteger + 2,
      }),
    ).toBeNull();
    expect(normalizeKnowledgeSearchResult({ ...validResult, pageIndex: unsafeInteger })).toBeNull();
  });

  it('rejects falsy non-string chunk heading metadata', () => {
    expect(normalizeKnowledgeSearchChunkRecord({ ...validChunk, headingId: false })).toBeNull();
    expect(normalizeKnowledgeSearchChunkRecord({ ...validChunk, heading: 0 })).toBeNull();
  });

  it('rejects unknown versions and invalid ranges', () => {
    expect(
      normalizeKnowledgeSearchChunkRecord({
        id: 'chunk1',
        documentId: 'document1',
        checksum: 'a'.repeat(64),
        pageNumber: 0,
        passageNumber: 1,
        text: 'text',
        normalizedText: 'text',
        normalizedStart: 4,
        normalizedEnd: 2,
        indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION + 1,
        indexedAt: '2026-07-19T18:00:00.000Z',
        created: '2026-07-19T18:00:00.000Z',
        updated: '2026-07-19T18:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('bounds all and document scopes independently', () => {
    expect(boundedSearchLimit({ kind: 'all' }, 999)).toBe(20);
    expect(boundedSearchLimit({ kind: 'document', documentId: 'document1' }, 999)).toBe(50);
  });

  it('rejects malformed successful responses before they cross IPC', () => {
    expect(
      normalizeKnowledgeSearchResponse({
        ok: true,
        requestId: 'request1',
        availability: 'ready',
        normalizedQuery: 'failover',
        results: [
          {
            id: 'chunk1',
            documentId: 'document1',
            checksum: 'a'.repeat(64),
            title: 'Runbook',
            fileName: 'Runbook.pdf',
            category: 'Operations',
            categoryId: null,
            documentType: 'sop',
            headingId: null,
            heading: null,
            pageIndex: 0,
            passageNumber: 1,
            excerpt: 'x'.repeat(281),
            matchKind: 'exact',
            highlightText: 'failover',
            normalizedStart: 0,
            normalizedEnd: 8,
            score: 1,
          },
        ],
      }),
    ).toBeNull();
  });

  it('bounds highlights by Unicode code points rather than UTF-16 code units', () => {
    expect(
      normalizeKnowledgeSearchResponse({
        ok: true,
        requestId: 'request1',
        availability: 'ready',
        normalizedQuery: 'failover',
        results: [{ ...validResult, highlightText: '😀'.repeat(100) }],
      }),
    ).not.toBeNull();
    expect(
      normalizeKnowledgeSearchResponse({
        ok: true,
        requestId: 'request1',
        availability: 'ready',
        normalizedQuery: 'failover',
        results: [{ ...validResult, highlightText: '😀'.repeat(121) }],
      }),
    ).toBeNull();
  });

  it('rejects falsy non-string result heading metadata', () => {
    expect(normalizeKnowledgeSearchResult({ ...validResult, headingId: false })).toBeNull();
    expect(normalizeKnowledgeSearchResult({ ...validResult, heading: 0 })).toBeNull();
  });
});
