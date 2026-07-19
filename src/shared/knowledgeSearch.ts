import type { KnowledgeDocumentType } from './knowledge';

export const KNOWLEDGE_SEARCH_CHUNKS_COLLECTION = 'knowledge_search_chunks';
export const KNOWLEDGE_SEARCH_INDEX_VERSION = 1;
export const KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS = 120;
export const KNOWLEDGE_SEARCH_GLOBAL_LIMIT = 20;
export const KNOWLEDGE_SEARCH_DOCUMENT_LIMIT = 50;
export const KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT = 1_600;
export const KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT = 280;
export const KNOWLEDGE_SEARCH_MAX_CHUNKS = 100_000;
export const KNOWLEDGE_SEARCH_MAX_TEXT_BYTES = 128 * 1024 * 1024;

export type KnowledgeSearchIndexState = 'pending' | 'ready' | 'failed';
export type KnowledgeSearchMatchKind = 'exact' | 'tokens' | 'prefix' | 'fuzzy';
export type KnowledgeSearchAvailability = 'ready' | 'cached';

export type KnowledgeSearchChunkRecord = {
  id: string;
  documentId: string;
  checksum: string;
  pageNumber: number;
  passageNumber: number;
  headingId: string | null;
  heading: string | null;
  text: string;
  normalizedText: string;
  normalizedStart: number;
  normalizedEnd: number;
  indexVersion: number;
  indexedAt: string;
  created: string;
  updated: string;
};

export type KnowledgeSearchScope = { kind: 'all' } | { kind: 'document'; documentId: string };

export type KnowledgeSearchRequest = {
  requestId: string;
  query: string;
  scope: KnowledgeSearchScope;
  categoryId: string | null;
  documentType: KnowledgeDocumentType | null;
  limit: number;
};

export type KnowledgeSearchResult = {
  id: string;
  documentId: string;
  checksum: string;
  title: string;
  fileName: string;
  category: string;
  categoryId: string | null;
  documentType: KnowledgeDocumentType;
  headingId: string | null;
  heading: string | null;
  pageIndex: number;
  passageNumber: number;
  excerpt: string;
  matchKind: KnowledgeSearchMatchKind;
  highlightText: string;
  normalizedStart: number;
  normalizedEnd: number;
  score: number;
};

export type KnowledgeSearchResponse =
  | {
      ok: true;
      requestId: string;
      availability: KnowledgeSearchAvailability;
      normalizedQuery: string;
      results: KnowledgeSearchResult[];
    }
  | {
      ok: false;
      requestId: string;
      error: 'invalid-query' | 'unavailable' | 'timeout' | 'cancelled';
    };

export const KNOWLEDGE_SEARCH_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export type KnowledgeSearchSourceRange = { start: number; end: number };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEARCH_INDEX_STATES: KnowledgeSearchIndexState[] = ['pending', 'ready', 'failed'];
const SEARCH_MATCH_KINDS: KnowledgeSearchMatchKind[] = ['exact', 'tokens', 'prefix', 'fuzzy'];
const SEARCH_AVAILABILITY: KnowledgeSearchAvailability[] = ['ready', 'cached'];
const SEARCH_RESPONSE_ERRORS: KnowledgeSearchResponse extends { ok: false; error: infer T }
  ? T[]
  : never = ['invalid-query', 'unavailable', 'timeout', 'cancelled'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function boundedNullableString(value: unknown, maximum: number): value is string | null {
  return value === null || boundedString(value, maximum);
}

function boundedIdentifier(value: unknown): value is string {
  return boundedString(value, 200) && IDENTIFIER_PATTERN.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    boundedString(value, 100) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function normalizeKnowledgeSearchTextWithRanges(value: string): {
  text: string;
  sourceRanges: KnowledgeSearchSourceRange[];
} {
  const segmenter = new Intl.Segmenter('en-US', { granularity: 'grapheme' });
  const sourceRanges: KnowledgeSearchSourceRange[] = [];
  let text = '';

  for (const segment of segmenter.segment(value)) {
    const sourceRange = {
      start: segment.index,
      end: segment.index + segment.segment.length,
    };
    const normalized = segment.segment.normalize('NFKC').toLocaleLowerCase('en-US');
    for (const character of normalized) {
      const whitespace = /\s/u.test(character);
      if (whitespace && (text.length === 0 || text.endsWith(' '))) continue;
      const emitted = whitespace ? ' ' : character;
      text += emitted;
      for (let codeUnit = 0; codeUnit < emitted.length; codeUnit += 1) {
        sourceRanges.push(sourceRange);
      }
    }
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    sourceRanges.pop();
  }
  return { text, sourceRanges };
}

export function normalizeKnowledgeSearchText(value: string): string {
  return normalizeKnowledgeSearchTextWithRanges(value).text;
}

export const normalizeKnowledgeSearchQuery = normalizeKnowledgeSearchText;

export function isKnowledgeSearchQueryEligible(value: string): boolean {
  const tokens =
    normalizeKnowledgeSearchQuery(value).match(/[\p{L}\p{N}][\p{L}\p{N}._:/-]*/gu) ?? [];
  return tokens.some((token) => !KNOWLEDGE_SEARCH_FUNCTION_WORDS.has(token));
}

export function boundedSearchLimit(scope: KnowledgeSearchScope, requested: number): number {
  const maximum =
    scope.kind === 'all' ? KNOWLEDGE_SEARCH_GLOBAL_LIMIT : KNOWLEDGE_SEARCH_DOCUMENT_LIMIT;
  if (!Number.isFinite(requested)) return 1;
  return Math.min(maximum, Math.max(1, Math.floor(requested)));
}

export function normalizeKnowledgeSearchChunkRecord(
  value: unknown,
): KnowledgeSearchChunkRecord | null {
  if (!isRecord(value)) return null;
  const headingId = value.headingId || null;
  const heading = value.heading || null;

  if (
    !boundedIdentifier(value.id) ||
    !boundedIdentifier(value.documentId) ||
    !isChecksum(value.checksum) ||
    !isPositiveInteger(value.pageNumber) ||
    !isPositiveInteger(value.passageNumber) ||
    !boundedNullableString(headingId, 200) ||
    !boundedNullableString(heading, 240) ||
    !boundedString(value.text, KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT) ||
    !boundedString(value.normalizedText, KNOWLEDGE_SEARCH_MAX_PASSAGE_TEXT) ||
    value.normalizedText !== normalizeKnowledgeSearchText(value.text) ||
    !isNonNegativeInteger(value.normalizedStart) ||
    !isPositiveInteger(value.normalizedEnd) ||
    (value.normalizedEnd as number) <= (value.normalizedStart as number) ||
    (value.normalizedEnd as number) - (value.normalizedStart as number) !==
      (value.normalizedText as string).length ||
    value.indexVersion !== KNOWLEDGE_SEARCH_INDEX_VERSION ||
    !isTimestamp(value.indexedAt) ||
    !isTimestamp(value.created) ||
    !isTimestamp(value.updated)
  ) {
    return null;
  }

  return {
    id: value.id,
    documentId: value.documentId,
    checksum: value.checksum,
    pageNumber: value.pageNumber,
    passageNumber: value.passageNumber,
    headingId,
    heading,
    text: value.text,
    normalizedText: value.normalizedText,
    normalizedStart: value.normalizedStart,
    normalizedEnd: value.normalizedEnd,
    indexVersion: value.indexVersion,
    indexedAt: value.indexedAt,
    created: value.created,
    updated: value.updated,
  };
}

export function normalizeKnowledgeSearchRequest(value: unknown): KnowledgeSearchRequest | null {
  if (!isRecord(value) || !boundedIdentifier(value.requestId) || typeof value.query !== 'string') {
    return null;
  }
  const query = normalizeKnowledgeSearchQuery(value.query);
  if (
    codePointLength(value.query) > KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS ||
    !isKnowledgeSearchQueryEligible(query) ||
    !isRecord(value.scope) ||
    !isPositiveInteger(value.limit) ||
    (value.categoryId !== null && !boundedIdentifier(value.categoryId)) ||
    (value.documentType !== null &&
      value.documentType !== 'sop' &&
      value.documentType !== 'cheatsheet')
  ) {
    return null;
  }

  let scope: KnowledgeSearchScope | null = null;
  if (value.scope.kind === 'all') {
    scope = { kind: 'all' };
  } else if (value.scope.kind === 'document' && boundedIdentifier(value.scope.documentId)) {
    scope = { kind: 'document', documentId: value.scope.documentId };
  }
  if (scope === null) return null;

  return {
    requestId: value.requestId,
    query,
    scope,
    categoryId: value.categoryId,
    documentType: value.documentType,
    limit: boundedSearchLimit(scope, value.limit),
  };
}

export function normalizeKnowledgeSearchResult(value: unknown): KnowledgeSearchResult | null {
  if (!isRecord(value)) return null;
  const headingId = value.headingId || null;
  const heading = value.heading || null;

  if (
    !boundedIdentifier(value.id) ||
    !boundedIdentifier(value.documentId) ||
    !isChecksum(value.checksum) ||
    !boundedString(value.title, 240) ||
    !boundedString(value.fileName, 240) ||
    !boundedString(value.category, 120) ||
    (value.categoryId !== null && !boundedIdentifier(value.categoryId)) ||
    (value.documentType !== 'sop' && value.documentType !== 'cheatsheet') ||
    !boundedNullableString(headingId, 200) ||
    !boundedNullableString(heading, 240) ||
    !isNonNegativeInteger(value.pageIndex) ||
    !isPositiveInteger(value.passageNumber) ||
    !boundedString(value.excerpt, KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT) ||
    !SEARCH_MATCH_KINDS.includes(value.matchKind as KnowledgeSearchMatchKind) ||
    !boundedString(value.highlightText, KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS) ||
    codePointLength(value.highlightText) > KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS ||
    !isNonNegativeInteger(value.normalizedStart) ||
    !isPositiveInteger(value.normalizedEnd) ||
    (value.normalizedEnd as number) <= (value.normalizedStart as number) ||
    typeof value.score !== 'number' ||
    !Number.isFinite(value.score)
  ) {
    return null;
  }

  return {
    id: value.id,
    documentId: value.documentId,
    checksum: value.checksum,
    title: value.title,
    fileName: value.fileName,
    category: value.category,
    categoryId: value.categoryId,
    documentType: value.documentType,
    headingId,
    heading,
    pageIndex: value.pageIndex,
    passageNumber: value.passageNumber,
    excerpt: value.excerpt,
    matchKind: value.matchKind as KnowledgeSearchMatchKind,
    highlightText: value.highlightText,
    normalizedStart: value.normalizedStart,
    normalizedEnd: value.normalizedEnd,
    score: value.score,
  };
}

export function normalizeKnowledgeSearchResponse(value: unknown): KnowledgeSearchResponse | null {
  if (!isRecord(value) || !boundedIdentifier(value.requestId) || typeof value.ok !== 'boolean') {
    return null;
  }
  if (!value.ok) {
    return SEARCH_RESPONSE_ERRORS.includes(value.error as never)
      ? {
          ok: false,
          requestId: value.requestId,
          error: value.error as KnowledgeSearchResponse['error'],
        }
      : null;
  }
  if (
    !SEARCH_AVAILABILITY.includes(value.availability as KnowledgeSearchAvailability) ||
    typeof value.normalizedQuery !== 'string' ||
    value.normalizedQuery !== normalizeKnowledgeSearchQuery(value.normalizedQuery) ||
    codePointLength(value.normalizedQuery) > KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS ||
    !Array.isArray(value.results) ||
    value.results.length > KNOWLEDGE_SEARCH_DOCUMENT_LIMIT
  ) {
    return null;
  }
  const results = value.results.map(normalizeKnowledgeSearchResult);
  return results.every((result) => result !== null)
    ? {
        ok: true,
        requestId: value.requestId,
        availability: value.availability as KnowledgeSearchAvailability,
        normalizedQuery: value.normalizedQuery,
        results: results as KnowledgeSearchResult[],
      }
    : null;
}

export function isKnowledgeSearchIndexState(value: unknown): value is KnowledgeSearchIndexState {
  return SEARCH_INDEX_STATES.includes(value as KnowledgeSearchIndexState);
}
