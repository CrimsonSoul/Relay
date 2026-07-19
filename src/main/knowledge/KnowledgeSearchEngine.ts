import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_FUNCTION_WORDS,
  KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT,
  KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS,
  normalizeKnowledgeSearchText,
  normalizeKnowledgeSearchTextWithRanges,
  type KnowledgeSearchChunkRecord,
  type KnowledgeSearchMatchKind,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResponse,
  type KnowledgeSearchResult,
  type KnowledgeSearchSourceRange,
} from '@shared/knowledgeSearch';

const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}._:/-]*/gu;
const IDENTIFIER_PATTERN = /\d|[._:/-]/u;
const FUNCTION_WORDS = KNOWLEDGE_SEARCH_FUNCTION_WORDS;
const FIELD_BONUSES = {
  title: 50,
  heading: 40,
  category: 30,
  fileName: 20,
  passage: 0,
} as const;
const MINIMUM_ACCEPTANCE_SCORE = 50;
const CHECK_INTERVAL = 100;

type SearchContext = { deadline: number; isCancelled: () => boolean };
type SearchField = keyof typeof FIELD_BONUSES;

type IndexedToken = {
  value: string;
  start: number;
  end: number;
  position: number;
};

type IndexedDocument = {
  record: KnowledgeDocumentRecord;
  fields: Pick<Record<SearchField, IndexedToken[]>, 'title' | 'category' | 'fileName'>;
};

type IndexedChunk = {
  record: KnowledgeSearchChunkRecord;
  document: IndexedDocument;
  sourceRanges: KnowledgeSearchSourceRange[];
  fields: Pick<Record<SearchField, IndexedToken[]>, 'heading' | 'passage'>;
};

type SearchSnapshot = {
  sourceDocuments: Map<string, KnowledgeDocumentRecord>;
  sourceChunks: Map<string, KnowledgeSearchChunkRecord>;
  documents: Map<string, IndexedDocument>;
  chunksById: Map<string, IndexedChunk>;
  chunkIdsByDocument: Map<string, readonly string[]>;
  exactPostings: Map<string, readonly string[]>;
  vocabularyByLength: Map<number, readonly string[]>;
  vocabularyByTrigram: Map<string, readonly string[]>;
  vocabularyPrefixes: Map<string, readonly string[]>;
};

type TokenAcceptance = {
  candidate: IndexedToken;
  distance: number;
  kind: 'exact' | 'prefix' | 'fuzzy';
};

type VocabularyAcceptance = { distance: number; kind: TokenAcceptance['kind'] };

type FieldAcceptance = {
  field: SearchField;
  tier: number;
  matchKind: KnowledgeSearchMatchKind;
  score: number;
  totalEditDistance: number;
  phraseGap: number;
  accepted: TokenAcceptance[];
  exactPhrase: { start: number; end: number } | null;
};

type ScoredResult = {
  result: KnowledgeSearchResult;
  passageStart: number;
  passageEnd: number;
};

class SearchCancelledError extends Error {
  constructor() {
    super('Knowledge search cancelled');
    this.name = 'SearchCancelledError';
  }
}

class SearchTimeoutError extends Error {
  constructor() {
    super('Knowledge search timed out');
    this.name = 'SearchTimeoutError';
  }
}

function allowedEdits(token: string): number {
  if (IDENTIFIER_PATTERN.test(token) || [...token].length <= 3) return 0;
  return [...token].length <= 7 ? 1 : 2;
}

function trigrams(token: string): Set<string> {
  const padded = `  ${token}  `;
  return new Set(
    Array.from({ length: Math.max(0, padded.length - 2) }, (_, index) =>
      padded.slice(index, index + 3),
    ),
  );
}

function tokens(value: string): IndexedToken[] {
  return [...value.matchAll(TOKEN_PATTERN)].flatMap((match, position) => {
    let tokenEnd = match[0].length;
    while (tokenEnd > 0 && match[0][tokenEnd - 1] === '.') tokenEnd -= 1;
    const token = match[0].slice(0, tokenEnd);
    return token
      ? [{ value: token, start: match.index, end: match.index + token.length, position }]
      : [];
  });
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function boundedDamerauLevenshtein(leftValue: string, rightValue: string, maximum: number): number {
  const left = [...leftValue];
  const right = [...rightValue];
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;

  let previousPrevious: number[] | null = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0]!;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      let distance = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        substitution,
      );
      if (
        previousPrevious !== null &&
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        distance = Math.min(distance, previousPrevious[rightIndex - 2]! + 1);
      }
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length]!;
}

function emptySnapshot(): SearchSnapshot {
  return {
    sourceDocuments: new Map(),
    sourceChunks: new Map(),
    documents: new Map(),
    chunksById: new Map(),
    chunkIdsByDocument: new Map(),
    exactPostings: new Map(),
    vocabularyByLength: new Map(),
    vocabularyByTrigram: new Map(),
    vocabularyPrefixes: new Map(),
  };
}

function addToSetMap(
  map: Map<string | number, Set<string>>,
  key: string | number,
  value: string,
): void {
  const existing = map.get(key);
  if (existing) existing.add(value);
  else map.set(key, new Set([value]));
}

function freezeSetMap<Key extends string | number>(map: Map<Key, Set<string>>): Map<Key, string[]> {
  const compareKeys = ([left]: [Key, Set<string>], [right]: [Key, Set<string>]) => {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return compareText(String(left), String(right));
  };
  return new Map(
    [...map.entries()]
      .sort(compareKeys)
      .map(([key, values]) => [key, [...values].sort(compareText)]),
  );
}

function metadataTokens(document: IndexedDocument): IndexedToken[] {
  return [...document.fields.title, ...document.fields.category, ...document.fields.fileName];
}

function createIndexedDocument(record: KnowledgeDocumentRecord): IndexedDocument {
  return {
    record,
    fields: {
      title: tokens(normalizeKnowledgeSearchText(record.displayTitle || record.title)),
      category: tokens(normalizeKnowledgeSearchText(record.category)),
      fileName: tokens(normalizeKnowledgeSearchText(record.fileName)),
    },
  };
}

function createIndexedChunk(
  record: KnowledgeSearchChunkRecord,
  document: IndexedDocument,
): IndexedChunk | null {
  if (record.checksum !== document.record.checksum) return null;
  const normalized = normalizeKnowledgeSearchTextWithRanges(record.text);
  if (normalized.text !== record.normalizedText) {
    throw new Error(`Knowledge search chunk ${record.id} normalizedText does not match text`);
  }
  return {
    record,
    document,
    sourceRanges: normalized.sourceRanges,
    fields: {
      heading: tokens(normalizeKnowledgeSearchText(record.heading ?? '')),
      passage: tokens(record.normalizedText),
    },
  };
}

function indexDocuments(
  sourceDocuments: ReadonlyMap<string, KnowledgeDocumentRecord>,
): Map<string, IndexedDocument> {
  const documents = new Map<string, IndexedDocument>();
  for (const record of sourceDocuments.values()) {
    if (record.lifecycleState !== 'active') continue;
    documents.set(record.id, createIndexedDocument(record));
  }
  return documents;
}

function indexChunks(
  sourceChunks: ReadonlyMap<string, KnowledgeSearchChunkRecord>,
  documents: ReadonlyMap<string, IndexedDocument>,
): IndexedChunk[] {
  const indexedChunks: IndexedChunk[] = [];
  for (const record of sourceChunks.values()) {
    const document = documents.get(record.documentId);
    if (!document) continue;
    const indexed = createIndexedChunk(record, document);
    if (indexed) indexedChunks.push(indexed);
  }
  indexedChunks.sort(
    (left, right) =>
      compareText(left.record.documentId, right.record.documentId) ||
      left.record.pageNumber - right.record.pageNumber ||
      left.record.passageNumber - right.record.passageNumber ||
      compareText(left.record.id, right.record.id),
  );
  return indexedChunks;
}

function buildVocabularyIndexes(indexedChunks: readonly IndexedChunk[]) {
  const exactPostings = new Map<string, Set<string>>();
  const vocabularyByLength = new Map<number, Set<string>>();
  const vocabularyByTrigram = new Map<string, Set<string>>();
  const vocabularyPrefixes = new Map<string, Set<string>>();
  for (const chunk of indexedChunks) {
    const chunkTokens = [
      ...metadataTokens(chunk.document),
      ...chunk.fields.heading,
      ...chunk.fields.passage,
    ];
    for (const token of chunkTokens) addToSetMap(exactPostings, token.value, chunk.record.id);
  }

  for (const vocabularyToken of exactPostings.keys()) {
    const tokenLength = [...vocabularyToken].length;
    addToSetMap(vocabularyByLength, tokenLength, vocabularyToken);
    for (const trigram of trigrams(vocabularyToken)) {
      addToSetMap(vocabularyByTrigram, trigram, vocabularyToken);
    }
    if (allowedEdits(vocabularyToken) > 0) {
      for (let prefixLength = 4; prefixLength < tokenLength; prefixLength += 1) {
        addToSetMap(
          vocabularyPrefixes,
          [...vocabularyToken].slice(0, prefixLength).join(''),
          vocabularyToken,
        );
      }
    }
  }
  return {
    exactPostings: freezeSetMap(exactPostings),
    vocabularyByLength: freezeSetMap(vocabularyByLength),
    vocabularyByTrigram: freezeSetMap(vocabularyByTrigram),
    vocabularyPrefixes: freezeSetMap(vocabularyPrefixes),
  };
}

function buildSnapshot(
  sourceDocuments: ReadonlyMap<string, KnowledgeDocumentRecord>,
  sourceChunks: ReadonlyMap<string, KnowledgeSearchChunkRecord>,
): SearchSnapshot {
  const immutableDocuments = new Map(
    [...sourceDocuments].map(([id, document]) => [id, structuredClone(document)]),
  );
  const immutableChunks = new Map(
    [...sourceChunks].map(([id, chunk]) => [id, structuredClone(chunk)]),
  );
  const documents = indexDocuments(immutableDocuments);
  const indexedChunks = indexChunks(immutableChunks, documents);

  return {
    sourceDocuments: immutableDocuments,
    sourceChunks: immutableChunks,
    documents,
    chunksById: new Map(indexedChunks.map((chunk) => [chunk.record.id, chunk])),
    chunkIdsByDocument: groupChunkIdsByDocument(immutableChunks.values()),
    ...buildVocabularyIndexes(indexedChunks),
  };
}

function groupChunkIdsByDocument(
  chunks: Iterable<KnowledgeSearchChunkRecord>,
): Map<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const chunk of chunks) {
    const existing = grouped.get(chunk.documentId);
    if (existing) existing.push(chunk.id);
    else grouped.set(chunk.documentId, [chunk.id]);
  }
  for (const ids of grouped.values()) ids.sort(compareText);
  return grouped;
}

function addSortedValue(values: readonly string[] | undefined, value: string): readonly string[] {
  if (values?.includes(value)) return values;
  return [...(values ?? []), value].sort(compareText);
}

function removeSortedValue(
  values: readonly string[] | undefined,
  value: string,
): readonly string[] {
  return values?.filter((candidate) => candidate !== value) ?? [];
}

function addVocabularyToken(snapshot: SearchSnapshot, vocabularyToken: string): void {
  const tokenCharacters = [...vocabularyToken];
  snapshot.vocabularyByLength.set(
    tokenCharacters.length,
    addSortedValue(snapshot.vocabularyByLength.get(tokenCharacters.length), vocabularyToken),
  );
  for (const trigram of trigrams(vocabularyToken)) {
    snapshot.vocabularyByTrigram.set(
      trigram,
      addSortedValue(snapshot.vocabularyByTrigram.get(trigram), vocabularyToken),
    );
  }
  if (allowedEdits(vocabularyToken) === 0) return;
  for (let prefixLength = 4; prefixLength < tokenCharacters.length; prefixLength += 1) {
    const prefix = tokenCharacters.slice(0, prefixLength).join('');
    snapshot.vocabularyPrefixes.set(
      prefix,
      addSortedValue(snapshot.vocabularyPrefixes.get(prefix), vocabularyToken),
    );
  }
}

function removeListEntry<Key>(map: Map<Key, readonly string[]>, key: Key, value: string): void {
  const remaining = removeSortedValue(map.get(key), value);
  if (remaining.length === 0) map.delete(key);
  else map.set(key, remaining);
}

function removeVocabularyToken(snapshot: SearchSnapshot, vocabularyToken: string): void {
  const tokenCharacters = [...vocabularyToken];
  removeListEntry(snapshot.vocabularyByLength, tokenCharacters.length, vocabularyToken);
  for (const trigram of trigrams(vocabularyToken)) {
    removeListEntry(snapshot.vocabularyByTrigram, trigram, vocabularyToken);
  }
  if (allowedEdits(vocabularyToken) === 0) return;
  for (let prefixLength = 4; prefixLength < tokenCharacters.length; prefixLength += 1) {
    removeListEntry(
      snapshot.vocabularyPrefixes,
      tokenCharacters.slice(0, prefixLength).join(''),
      vocabularyToken,
    );
  }
}

function indexedChunkVocabulary(chunk: IndexedChunk): Set<string> {
  return new Set(
    [...metadataTokens(chunk.document), ...chunk.fields.heading, ...chunk.fields.passage].map(
      ({ value }) => value,
    ),
  );
}

function addPosting(snapshot: SearchSnapshot, vocabularyToken: string, chunkId: string): void {
  const postings = snapshot.exactPostings.get(vocabularyToken);
  if (!postings) addVocabularyToken(snapshot, vocabularyToken);
  snapshot.exactPostings.set(vocabularyToken, addSortedValue(postings, chunkId));
}

function removePosting(snapshot: SearchSnapshot, vocabularyToken: string, chunkId: string): void {
  const remaining = removeSortedValue(snapshot.exactPostings.get(vocabularyToken), chunkId);
  if (remaining.length === 0) {
    snapshot.exactPostings.delete(vocabularyToken);
    removeVocabularyToken(snapshot, vocabularyToken);
  } else {
    snapshot.exactPostings.set(vocabularyToken, remaining);
  }
}

function replaceIndexedChunk(
  snapshot: SearchSnapshot,
  chunkId: string,
  next: IndexedChunk | null,
): IndexedChunk | null {
  const previous = snapshot.chunksById.get(chunkId) ?? null;
  const previousVocabulary = previous ? indexedChunkVocabulary(previous) : new Set<string>();
  const nextVocabulary = next ? indexedChunkVocabulary(next) : new Set<string>();
  if (next) snapshot.chunksById.set(chunkId, next);
  else snapshot.chunksById.delete(chunkId);
  for (const token of previousVocabulary) {
    if (!nextVocabulary.has(token)) removePosting(snapshot, token, chunkId);
  }
  for (const token of nextVocabulary) {
    if (!previousVocabulary.has(token)) addPosting(snapshot, token, chunkId);
  }
  return previous;
}

function removeIndexedChunk(snapshot: SearchSnapshot, chunkId: string): IndexedChunk | null {
  return replaceIndexedChunk(snapshot, chunkId, null);
}

function forkSnapshot(snapshot: SearchSnapshot): SearchSnapshot {
  return {
    sourceDocuments: new Map(snapshot.sourceDocuments),
    sourceChunks: new Map(snapshot.sourceChunks),
    documents: new Map(snapshot.documents),
    chunksById: new Map(snapshot.chunksById),
    chunkIdsByDocument: new Map(snapshot.chunkIdsByDocument),
    exactPostings: new Map(snapshot.exactPostings),
    vocabularyByLength: new Map(snapshot.vocabularyByLength),
    vocabularyByTrigram: new Map(snapshot.vocabularyByTrigram),
    vocabularyPrefixes: new Map(snapshot.vocabularyPrefixes),
  };
}

function setChunkDocumentMembership(
  snapshot: SearchSnapshot,
  documentId: string,
  chunkId: string,
  present: boolean,
): void {
  const ids = present
    ? addSortedValue(snapshot.chunkIdsByDocument.get(documentId), chunkId)
    : removeSortedValue(snapshot.chunkIdsByDocument.get(documentId), chunkId);
  if (ids.length === 0) snapshot.chunkIdsByDocument.delete(documentId);
  else snapshot.chunkIdsByDocument.set(documentId, ids);
}

function existingIndexedChunks(
  snapshot: SearchSnapshot,
  chunkIds: readonly string[],
): Map<string, IndexedChunk> {
  return new Map(
    chunkIds.flatMap((id) => {
      const chunk = snapshot.chunksById.get(id);
      return chunk ? [[id, chunk] as const] : [];
    }),
  );
}

function nextIndexedChunksForDocument(
  snapshot: SearchSnapshot,
  chunkIds: readonly string[],
  previousChunks: ReadonlyMap<string, IndexedChunk>,
  document: IndexedDocument | null,
): IndexedChunk[] {
  if (!document) return [];
  const indexedChunks: IndexedChunk[] = [];
  for (const chunkId of chunkIds) {
    const source = snapshot.sourceChunks.get(chunkId);
    if (!source || source.checksum !== document.record.checksum) continue;
    const previous = previousChunks.get(chunkId);
    const indexed =
      previous?.record === source
        ? { ...previous, document }
        : createIndexedChunk(source, document);
    if (indexed) indexedChunks.push(indexed);
  }
  return indexedChunks;
}

function upsertDocumentIncrementally(
  snapshot: SearchSnapshot,
  input: KnowledgeDocumentRecord,
): void {
  const record = structuredClone(input);
  const chunkIds = snapshot.chunkIdsByDocument.get(record.id) ?? [];
  const previousChunks = existingIndexedChunks(snapshot, chunkIds);
  const document = record.lifecycleState === 'active' ? createIndexedDocument(record) : null;
  const nextChunks = nextIndexedChunksForDocument(snapshot, chunkIds, previousChunks, document);

  snapshot.sourceDocuments.set(record.id, record);
  if (document) snapshot.documents.set(record.id, document);
  else snapshot.documents.delete(record.id);
  const nextChunksById = new Map(nextChunks.map((chunk) => [chunk.record.id, chunk]));
  for (const chunkId of chunkIds) {
    replaceIndexedChunk(snapshot, chunkId, nextChunksById.get(chunkId) ?? null);
  }
}

function removeDocumentIncrementally(snapshot: SearchSnapshot, documentId: string): void {
  const chunkIds = snapshot.chunkIdsByDocument.get(documentId) ?? [];
  for (const chunkId of chunkIds) {
    removeIndexedChunk(snapshot, chunkId);
    snapshot.sourceChunks.delete(chunkId);
  }
  snapshot.chunkIdsByDocument.delete(documentId);
  snapshot.documents.delete(documentId);
  snapshot.sourceDocuments.delete(documentId);
}

function upsertChunkIncrementally(
  snapshot: SearchSnapshot,
  input: KnowledgeSearchChunkRecord,
): void {
  const record = structuredClone(input);
  const previousSource = snapshot.sourceChunks.get(record.id);
  const document = snapshot.documents.get(record.documentId);
  const indexed = document ? createIndexedChunk(record, document) : null;
  if (previousSource && previousSource.documentId !== record.documentId) {
    setChunkDocumentMembership(snapshot, previousSource.documentId, record.id, false);
  }
  snapshot.sourceChunks.set(record.id, record);
  setChunkDocumentMembership(snapshot, record.documentId, record.id, true);
  replaceIndexedChunk(snapshot, record.id, indexed);
}

function removeChunkIncrementally(snapshot: SearchSnapshot, chunkId: string): void {
  const source = snapshot.sourceChunks.get(chunkId);
  removeIndexedChunk(snapshot, chunkId);
  snapshot.sourceChunks.delete(chunkId);
  if (source) setChunkDocumentMembership(snapshot, source.documentId, chunkId, false);
}

function checkContext(context: SearchContext): void {
  if (context.isCancelled()) throw new SearchCancelledError();
  if (performance.now() > context.deadline) throw new SearchTimeoutError();
}

async function cooperativeCheckpoint(context: SearchContext): Promise<void> {
  checkContext(context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  checkContext(context);
}

function exactPhrase(tokensInField: readonly IndexedToken[], queryTokens: readonly string[]) {
  if (queryTokens.length === 0 || tokensInField.length < queryTokens.length) return null;
  for (let start = 0; start <= tokensInField.length - queryTokens.length; start += 1) {
    if (queryTokens.every((token, offset) => tokensInField[start + offset]?.value === token)) {
      return {
        start: tokensInField[start]!.start,
        end: tokensInField[start + queryTokens.length - 1]!.end,
      };
    }
  }
  return null;
}

function bestTokenAcceptance(
  queryToken: string,
  fieldTokens: readonly IndexedToken[],
  acceptedVocabulary: ReadonlyMap<string, { distance: number; kind: TokenAcceptance['kind'] }>,
  usedPositions: ReadonlySet<number>,
): TokenAcceptance | null {
  let best: TokenAcceptance | null = null;
  for (const candidate of fieldTokens) {
    if (usedPositions.has(candidate.position)) continue;
    const accepted = acceptedVocabulary.get(candidate.value);
    if (!accepted) continue;
    const next = { candidate, ...accepted };
    if (
      best === null ||
      next.distance < best.distance ||
      (next.distance === best.distance && candidate.position < best.candidate.position) ||
      (next.distance === best.distance &&
        candidate.position === best.candidate.position &&
        compareText(candidate.value, best.candidate.value) < 0)
    ) {
      best = next;
    }
  }
  return best;
}

function evaluateField(
  field: SearchField,
  fieldTokens: readonly IndexedToken[],
  allQueryTokens: readonly string[],
  contentQueryTokens: readonly string[],
  vocabulary: ReadonlyMap<
    string,
    ReadonlyMap<string, { distance: number; kind: TokenAcceptance['kind'] }>
  >,
): FieldAcceptance | null {
  const phrase = exactPhrase(fieldTokens, allQueryTokens);
  const accepted: TokenAcceptance[] = [];
  const usedPositions = new Set<number>();
  for (const queryToken of contentQueryTokens) {
    const match = bestTokenAcceptance(
      queryToken,
      fieldTokens,
      vocabulary.get(queryToken)!,
      usedPositions,
    );
    if (!match) return null;
    accepted.push(match);
    usedPositions.add(match.candidate.position);
  }

  const totalEditDistance = accepted.reduce((total, match) => total + match.distance, 0);
  const orderedPositions = accepted
    .map(({ candidate }) => candidate.position)
    .sort((a, b) => a - b);
  const phraseGap = Math.max(
    0,
    (orderedPositions.at(-1) ?? 0) - (orderedPositions[0] ?? 0) - (orderedPositions.length - 1),
  );
  const acceptedStart = Math.min(...accepted.map(({ candidate }) => candidate.position));
  let tier: number;
  let matchKind: KnowledgeSearchMatchKind;
  if (phrase !== null) {
    tier = 500;
    matchKind = 'exact';
  } else if (accepted.every(({ kind }) => kind === 'exact')) {
    tier = 400;
    matchKind = 'tokens';
  } else if (accepted.every(({ kind }) => kind !== 'fuzzy')) {
    tier = 300;
    matchKind = 'prefix';
  } else if (accepted.every(({ distance }) => distance <= 1)) {
    tier = 200;
    matchKind = 'fuzzy';
  } else {
    tier = 100;
    matchKind = 'fuzzy';
  }
  const score =
    tier +
    FIELD_BONUSES[field] -
    10 * totalEditDistance -
    Math.min(25, phraseGap) -
    Math.min(25, acceptedStart);
  if (score < MINIMUM_ACCEPTANCE_SCORE) return null;
  return {
    field,
    tier,
    matchKind,
    score,
    totalEditDistance,
    phraseGap,
    accepted,
    exactPhrase: phrase,
  };
}

function compareAcceptance(left: FieldAcceptance, right: FieldAcceptance): number {
  return (
    right.score - left.score ||
    right.tier - left.tier ||
    left.totalEditDistance - right.totalEditDistance ||
    left.phraseGap - right.phraseGap ||
    compareText(left.field, right.field)
  );
}

function passageHighlight(
  chunk: IndexedChunk,
  allQueryTokens: readonly string[],
  contentQueryTokens: readonly string[],
  vocabulary: ReadonlyMap<
    string,
    ReadonlyMap<string, { distance: number; kind: TokenAcceptance['kind'] }>
  >,
): { start: number; end: number } {
  const phrase = exactPhrase(chunk.fields.passage, allQueryTokens);
  if (phrase) return phrase;

  const matches = contentQueryTokens.flatMap((queryToken, queryPosition) => {
    const acceptedVocabulary = vocabulary.get(queryToken)!;
    return chunk.fields.passage.flatMap((candidate) => {
      const accepted = acceptedVocabulary.get(candidate.value);
      return accepted ? [{ candidate, queryPosition, ...accepted }] : [];
    });
  });
  matches.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.queryPosition - right.queryPosition ||
      left.candidate.position - right.candidate.position ||
      compareText(left.candidate.value, right.candidate.value),
  );
  const best = matches[0]?.candidate ?? chunk.fields.passage[0];
  return best ? { start: best.start, end: best.end } : { start: 0, end: 1 };
}

function excerptForHighlight(chunk: IndexedChunk, start: number, end: number): string {
  const rawStart = chunk.sourceRanges[start]?.start ?? 0;
  const rawEnd = chunk.sourceRanges[end - 1]?.end ?? rawStart + 1;
  const source = chunk.record.text;
  const beforeAll = [...source.slice(0, rawStart)];
  const match = source.slice(rawStart, rawEnd);
  const afterAll = [...source.slice(rawEnd)];
  const before = beforeAll.slice(-120);
  const after = afterAll.slice(0, 120);
  const truncatedBefore = before.length < beforeAll.length;
  const truncatedAfter = after.length < afterAll.length;
  const prefix = truncatedBefore ? '…' : '';
  const suffix = truncatedAfter ? '…' : '';

  const render = () => `${prefix}${before.join('')}${match}${after.join('')}${suffix}`;
  let removeFromBefore = true;
  while (render().length > KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT && (before.length || after.length)) {
    if (removeFromBefore && before.length) before.shift();
    else if (after.length) after.pop();
    else before.shift();
    removeFromBefore = !removeFromBefore;
  }
  return render().slice(0, KNOWLEDGE_SEARCH_MAX_EXCERPT_TEXT);
}

function scoreChunk(
  chunk: IndexedChunk,
  allQueryTokens: readonly string[],
  contentQueryTokens: readonly string[],
  vocabulary: ReadonlyMap<
    string,
    ReadonlyMap<string, { distance: number; kind: TokenAcceptance['kind'] }>
  >,
): ScoredResult | null {
  const fieldTokens: Record<SearchField, readonly IndexedToken[]> = {
    title: chunk.document.fields.title,
    heading: chunk.fields.heading,
    category: chunk.document.fields.category,
    fileName: chunk.document.fields.fileName,
    passage: chunk.fields.passage,
  };
  const acceptances = (Object.keys(FIELD_BONUSES) as SearchField[])
    .map((field) =>
      evaluateField(field, fieldTokens[field], allQueryTokens, contentQueryTokens, vocabulary),
    )
    .filter((acceptance): acceptance is FieldAcceptance => acceptance !== null)
    .sort(compareAcceptance);
  const best = acceptances[0];
  if (!best) return null;

  const highlight = passageHighlight(chunk, allQueryTokens, contentQueryTokens, vocabulary);
  const highlightText = chunk.record.normalizedText.slice(highlight.start, highlight.end);
  if (!highlightText || [...highlightText].length > KNOWLEDGE_SEARCH_MAX_QUERY_CODE_POINTS)
    return null;
  const document = chunk.document.record;
  return {
    passageStart: chunk.record.normalizedStart,
    passageEnd: chunk.record.normalizedEnd,
    result: {
      id: chunk.record.id,
      documentId: document.id,
      checksum: document.checksum,
      title: document.displayTitle || document.title,
      fileName: document.fileName,
      category: document.category,
      categoryId: document.categoryId,
      documentType: document.documentType,
      headingId: chunk.record.headingId,
      heading: chunk.record.heading,
      pageIndex: chunk.record.pageNumber - 1,
      passageNumber: chunk.record.passageNumber,
      excerpt: excerptForHighlight(chunk, highlight.start, highlight.end),
      matchKind: best.matchKind,
      highlightText,
      normalizedStart: chunk.record.normalizedStart + highlight.start,
      normalizedEnd: chunk.record.normalizedStart + highlight.end,
      score: best.score,
    },
  };
}

function compareResults(left: ScoredResult, right: ScoredResult): number {
  return (
    right.result.score - left.result.score ||
    compareText(left.result.documentId, right.result.documentId) ||
    left.result.pageIndex - right.result.pageIndex ||
    left.result.passageNumber - right.result.passageNumber ||
    compareText(left.result.id, right.result.id)
  );
}

function collapseAndLimit(results: readonly ScoredResult[], request: KnowledgeSearchRequest) {
  const selected: ScoredResult[] = [];
  const perDocument = new Map<string, number>();
  for (const candidate of results) {
    const count = perDocument.get(candidate.result.documentId) ?? 0;
    if (count >= 3) continue;
    const overlaps = selected.some(
      (existing) =>
        existing.result.documentId === candidate.result.documentId &&
        existing.result.pageIndex === candidate.result.pageIndex &&
        candidate.passageStart <= existing.passageEnd &&
        candidate.passageEnd >= existing.passageStart,
    );
    if (overlaps) continue;
    selected.push(candidate);
    perDocument.set(candidate.result.documentId, count + 1);
    if (selected.length >= request.limit) break;
  }
  return selected.map(({ result }) => result);
}

function vocabularyAtAllowedLengths(
  queryToken: string,
  maximum: number,
  snapshot: SearchSnapshot,
): Set<string> {
  const vocabulary = new Set<string>();
  const queryLength = [...queryToken].length;
  for (let length = queryLength - maximum; length <= queryLength + maximum; length += 1) {
    for (const candidate of snapshot.vocabularyByLength.get(length) ?? [])
      vocabulary.add(candidate);
  }
  return vocabulary;
}

async function trigramIntersectionCounts(
  queryTrigrams: ReadonlySet<string>,
  allowedVocabulary: ReadonlySet<string>,
  snapshot: SearchSnapshot,
  context: SearchContext,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let operations = 0;
  for (const trigram of queryTrigrams) {
    for (const candidate of snapshot.vocabularyByTrigram.get(trigram) ?? []) {
      operations += 1;
      if (operations % CHECK_INTERVAL === 0) await cooperativeCheckpoint(context);
      if (allowedVocabulary.has(candidate)) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }
  return counts;
}

function fuzzyAcceptance(
  queryToken: string,
  candidate: string,
  intersection: number,
  queryTrigramCount: number,
  maximum: number,
): VocabularyAcceptance | null {
  if (
    candidate === queryToken ||
    candidate.startsWith(queryToken) ||
    allowedEdits(candidate) === 0
  ) {
    return null;
  }
  const candidateTrigramCount = trigrams(candidate).size;
  const requiredIntersection = Math.max(
    1,
    Math.min(queryTrigramCount, candidateTrigramCount) - 4 * maximum,
  );
  if (intersection < requiredIntersection) return null;
  const distance = boundedDamerauLevenshtein(queryToken, candidate, maximum);
  return distance <= maximum ? { distance, kind: 'fuzzy' } : null;
}

async function acceptedVocabularyForToken(
  queryToken: string,
  snapshot: SearchSnapshot,
  context: SearchContext,
): Promise<Map<string, VocabularyAcceptance>> {
  const accepted = new Map<string, VocabularyAcceptance>();
  if (snapshot.exactPostings.has(queryToken)) {
    accepted.set(queryToken, { distance: 0, kind: 'exact' });
  }
  const maximum = allowedEdits(queryToken);
  if (maximum === 0) return accepted;

  await addPrefixVocabularyCandidates(queryToken, snapshot, accepted, context);

  const queryTrigrams = trigrams(queryToken);
  const allowedVocabulary = vocabularyAtAllowedLengths(queryToken, maximum, snapshot);
  const intersectionCounts = await trigramIntersectionCounts(
    queryTrigrams,
    allowedVocabulary,
    snapshot,
    context,
  );

  const candidates = [...intersectionCounts.entries()].sort(([left], [right]) =>
    compareText(left, right),
  );
  for (let index = 0; index < candidates.length; index += 1) {
    if ((index + 1) % CHECK_INTERVAL === 0) await cooperativeCheckpoint(context);
    const [candidate, intersection] = candidates[index]!;
    const fuzzy = fuzzyAcceptance(queryToken, candidate, intersection, queryTrigrams.size, maximum);
    if (fuzzy) accepted.set(candidate, fuzzy);
  }
  return accepted;
}

async function addPrefixVocabularyCandidates(
  queryToken: string,
  snapshot: SearchSnapshot,
  accepted: Map<string, VocabularyAcceptance>,
  context: SearchContext,
): Promise<void> {
  const candidates = snapshot.vocabularyPrefixes.get(queryToken) ?? [];
  for (let index = 0; index < candidates.length; index += 1) {
    accepted.set(candidates[index]!, { distance: 0, kind: 'prefix' });
    if ((index + 1) % CHECK_INTERVAL === 0) await cooperativeCheckpoint(context);
  }
}

type QueryVocabulary = ReadonlyMap<string, ReadonlyMap<string, VocabularyAcceptance>>;

async function buildQueryVocabulary(
  queryTokens: readonly string[],
  snapshot: SearchSnapshot,
  context: SearchContext,
): Promise<QueryVocabulary> {
  const vocabulary = new Map<string, ReadonlyMap<string, VocabularyAcceptance>>();
  for (const queryToken of queryTokens) {
    vocabulary.set(queryToken, await acceptedVocabularyForToken(queryToken, snapshot, context));
  }
  return vocabulary;
}

async function candidateChunkIds(
  queryTokens: readonly string[],
  vocabulary: QueryVocabulary,
  snapshot: SearchSnapshot,
  context: SearchContext,
): Promise<Set<string>> {
  let candidates: Set<string> | null = null;
  let postingCandidates = 0;
  for (const queryToken of queryTokens) {
    const tokenCandidates = new Set<string>();
    for (const vocabularyToken of vocabulary.get(queryToken)!.keys()) {
      for (const chunkId of snapshot.exactPostings.get(vocabularyToken) ?? []) {
        tokenCandidates.add(chunkId);
        postingCandidates += 1;
        if (postingCandidates % CHECK_INTERVAL === 0) await cooperativeCheckpoint(context);
      }
    }
    if (candidates === null) candidates = tokenCandidates;
    else candidates = new Set([...candidates].filter((chunkId) => tokenCandidates.has(chunkId)));
    if (candidates.size === 0) break;
  }
  return candidates ?? new Set();
}

function chunkMatchesRequest(chunk: IndexedChunk, request: KnowledgeSearchRequest): boolean {
  const record = chunk.document.record;
  return (
    (request.scope.kind === 'all' || record.id === request.scope.documentId) &&
    (request.categoryId === null || record.categoryId === request.categoryId) &&
    (request.documentType === null || record.documentType === request.documentType)
  );
}

function candidateChunks(
  ids: ReadonlySet<string>,
  snapshot: SearchSnapshot,
  request: KnowledgeSearchRequest,
): IndexedChunk[] {
  return [...ids]
    .map((id) => snapshot.chunksById.get(id))
    .filter((chunk): chunk is IndexedChunk => chunk !== undefined)
    .filter((chunk) => chunkMatchesRequest(chunk, request));
}

async function scoreCandidates(
  candidates: readonly IndexedChunk[],
  allQueryTokens: readonly string[],
  contentQueryTokens: readonly string[],
  vocabulary: QueryVocabulary,
  context: SearchContext,
): Promise<ScoredResult[]> {
  const scored: ScoredResult[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if ((index + 1) % CHECK_INTERVAL === 0) await cooperativeCheckpoint(context);
    const result = scoreChunk(candidates[index]!, allQueryTokens, contentQueryTokens, vocabulary);
    if (result) scored.push(result);
  }
  return scored.sort(compareResults);
}

export class KnowledgeSearchEngine {
  private snapshot: SearchSnapshot = emptySnapshot();
  private readonly activeSnapshots = new Map<SearchSnapshot, number>();

  private writableSnapshot(): SearchSnapshot {
    const activeReaders = this.activeSnapshots.get(this.snapshot) ?? 0;
    if (activeReaders > 0) this.snapshot = forkSnapshot(this.snapshot);
    return this.snapshot;
  }

  replaceSnapshot(
    documents: readonly KnowledgeDocumentRecord[],
    chunks: readonly KnowledgeSearchChunkRecord[],
  ): void {
    this.snapshot = buildSnapshot(
      new Map(documents.map((document) => [document.id, document])),
      new Map(chunks.map((chunk) => [chunk.id, chunk])),
    );
  }

  upsertDocument(document: KnowledgeDocumentRecord): void {
    upsertDocumentIncrementally(this.writableSnapshot(), document);
  }

  removeDocument(documentId: string): void {
    removeDocumentIncrementally(this.writableSnapshot(), documentId);
  }

  upsertChunk(chunk: KnowledgeSearchChunkRecord): void {
    upsertChunkIncrementally(this.writableSnapshot(), chunk);
  }

  removeChunk(chunkId: string): void {
    removeChunkIncrementally(this.writableSnapshot(), chunkId);
  }

  async search(
    request: KnowledgeSearchRequest,
    context: { deadline: number; isCancelled: () => boolean },
  ): Promise<Extract<KnowledgeSearchResponse, { ok: true }>> {
    const snapshot = this.snapshot;
    this.activeSnapshots.set(snapshot, (this.activeSnapshots.get(snapshot) ?? 0) + 1);
    try {
      checkContext(context);
      const normalizedQuery = normalizeKnowledgeSearchText(request.query);
      const allQueryTokens = tokens(normalizedQuery).map(({ value }) => value);
      const contentQueryTokens = allQueryTokens.filter((token) => !FUNCTION_WORDS.has(token));
      if (contentQueryTokens.length === 0) {
        return {
          ok: true,
          requestId: request.requestId,
          availability: 'ready',
          normalizedQuery,
          results: [],
        };
      }

      const vocabulary = await buildQueryVocabulary(contentQueryTokens, snapshot, context);
      const candidates = candidateChunks(
        await candidateChunkIds(contentQueryTokens, vocabulary, snapshot, context),
        snapshot,
        request,
      );
      const scored = await scoreCandidates(
        candidates,
        allQueryTokens,
        contentQueryTokens,
        vocabulary,
        context,
      );
      checkContext(context);

      return {
        ok: true,
        requestId: request.requestId,
        availability: 'ready',
        normalizedQuery,
        results: collapseAndLimit(scored, request),
      };
    } finally {
      const remainingReaders = (this.activeSnapshots.get(snapshot) ?? 1) - 1;
      if (remainingReaders === 0) this.activeSnapshots.delete(snapshot);
      else this.activeSnapshots.set(snapshot, remainingReaders);
    }
  }
}
