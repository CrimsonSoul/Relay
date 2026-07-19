import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeSearchRequest } from '@shared/knowledgeSearch';
import { normalizeKnowledgeSearchText } from '@shared/knowledgeSearch';
import { KnowledgeSearchEngine } from '../KnowledgeSearchEngine';
import {
  KNOWLEDGE_SEARCH_NO_RESULT_CASES,
  KNOWLEDGE_SEARCH_RELEVANCE_CASES,
  KNOWLEDGE_SEARCH_RELEVANCE_CHUNKS,
  KNOWLEDGE_SEARCH_RELEVANCE_DOCUMENTS,
  KNOWLEDGE_SEARCH_RELEVANCE_FIXTURE_VERSION,
  knowledgeSearchFixtureChunk,
  knowledgeSearchFixtureDocument,
} from '../__fixtures__/knowledgeSearchRelevance';

const context = () => ({ deadline: Infinity, isCancelled: () => false });

function request(
  query: string,
  overrides: Partial<KnowledgeSearchRequest> = {},
): KnowledgeSearchRequest {
  return {
    requestId: 'search-request',
    query: normalizeKnowledgeSearchText(query),
    scope: { kind: 'all' },
    categoryId: null,
    documentType: null,
    limit: 20,
    ...overrides,
  };
}

function relevanceEngine(): KnowledgeSearchEngine {
  const engine = new KnowledgeSearchEngine();
  engine.replaceSnapshot(KNOWLEDGE_SEARCH_RELEVANCE_DOCUMENTS, KNOWLEDGE_SEARCH_RELEVANCE_CHUNKS);
  return engine;
}

describe('KnowledgeSearchEngine relevance fixture', () => {
  it('uses a versioned fixture with at least 30 named NOC queries', () => {
    expect(KNOWLEDGE_SEARCH_RELEVANCE_FIXTURE_VERSION).toBe(1);
    expect(KNOWLEDGE_SEARCH_RELEVANCE_CASES.length).toBeGreaterThanOrEqual(30);
    expect(KNOWLEDGE_SEARCH_RELEVANCE_CASES.every(({ name }) => name.length > 0)).toBe(true);
  });

  it.each(KNOWLEDGE_SEARCH_RELEVANCE_CASES)(
    '$name ranks $expectedDocumentId in the top three',
    async ({ query, expectedDocumentId }) => {
      const response = await relevanceEngine().search(request(query), context());
      expect(response.results.slice(0, 3).map(({ documentId }) => documentId)).toContain(
        expectedDocumentId,
      );
    },
  );

  it.each(KNOWLEDGE_SEARCH_NO_RESULT_CASES)('returns no weak guess for %s', async (query) => {
    expect((await relevanceEngine().search(request(query), context())).results).toEqual([]);
  });
});

describe('KnowledgeSearchEngine ranking', () => {
  it('assigns all five fixed ranking tiers', async () => {
    const examples = [
      ['exact', 'gateways failover now'],
      ['tokens', 'gateways controlled failover'],
      ['prefix', 'gatewayswitch failover'],
      ['fuzzy-one', 'gatewayz failover'],
      ['fuzzy-two', 'gatwasy failover'],
    ] as const;
    const documents = examples.map(([id]) =>
      knowledgeSearchFixtureDocument({ id: `tier-${id}`, title: 'Tier Examples' }),
    );
    const chunks = examples.map(([id, text], index) =>
      knowledgeSearchFixtureChunk(documents[index]!, text, { id }),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(documents, chunks);

    const results = (await engine.search(request('gateways failover'), context())).results;
    expect(Object.fromEntries(results.map((result) => [result.id, result.matchKind]))).toEqual({
      exact: 'exact',
      tokens: 'tokens',
      prefix: 'prefix',
      'fuzzy-one': 'fuzzy',
      'fuzzy-two': 'fuzzy',
    });
    expect(Object.fromEntries(results.map((result) => [result.id, result.score]))).toEqual({
      exact: 500,
      tokens: 399,
      prefix: 300,
      'fuzzy-one': 190,
      'fuzzy-two': 80,
    });
  });

  it('requires token boundaries and preserves adjacent transposition candidates', async () => {
    const document = knowledgeSearchFixtureDocument({ id: 'boundaries', title: 'Boundaries' });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(
      [document],
      [knowledgeSearchFixtureChunk(document, 'concatenate failvoer procedure', { id: 'only' })],
    );

    expect((await engine.search(request('cat'), context())).results).toEqual([]);
    expect((await engine.search(request('failover'), context())).results[0]).toMatchObject({
      id: 'only',
      matchKind: 'fuzzy',
      highlightText: 'failvoer',
    });
  });

  it('requires a distinct accepted occurrence for each repeated query token', async () => {
    const document = knowledgeSearchFixtureDocument({ id: 'repeated', title: 'Repeated Terms' });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(
      [document],
      [
        knowledgeSearchFixtureChunk(document, 'single target here', { id: 'single' }),
        knowledgeSearchFixtureChunk(document, 'target then target again', {
          id: 'repeated-match',
          normalizedStart: 100,
          passageNumber: 2,
        }),
      ],
    );

    expect(
      (await engine.search(request('target target'), context())).results.map(({ id }) => id),
    ).toEqual(['repeated-match']);
  });

  it('keeps short tokens, numeric tokens, and identifiers exact', async () => {
    const engine = relevanceEngine();
    const shortTokenResults = (await engine.search(request('rf'), context())).results;
    expect(shortTokenResults.length).toBeGreaterThan(0);
    expect(
      shortTokenResults.every((result) =>
        result.highlightText.toLocaleLowerCase('en-US').includes('rf'),
      ),
    ).toBe(true);
    expect((await engine.search(request('INC-1042'), context())).results).toHaveLength(1);
    expect((await engine.search(request('INC-1043'), context())).results).toHaveLength(0);
    expect((await engine.search(request('BG'), context())).results).toHaveLength(0);
  });

  it('enforces the 3-to-4 and 7-to-8 fuzzy edit boundaries', async () => {
    const examples = [
      ['three-prefix', 'cats'],
      ['four-one-edit', 'cuts'],
      ['four-two-edits', 'cuds'],
      ['seven-one-edit', 'netwrok'],
      ['seven-two-edits', 'netxxrk'],
      ['eight-two-edits', 'netxxrks'],
    ] as const;
    const documents = examples.map(([id]) =>
      knowledgeSearchFixtureDocument({
        id,
        title: 'Edit Boundary',
        category: 'Operations',
        categoryId: 'operations',
      }),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(
      documents,
      examples.map(([id, text], index) =>
        knowledgeSearchFixtureChunk(documents[index]!, text, { id }),
      ),
    );

    expect((await engine.search(request('cat'), context())).results).toEqual([]);
    expect((await engine.search(request('cats'), context())).results.map(({ id }) => id)).toEqual([
      'three-prefix',
      'four-one-edit',
    ]);
    expect(
      (await engine.search(request('network'), context())).results.map(({ id }) => id),
    ).toEqual(['seven-one-edit']);
    expect(
      (await engine.search(request('networks'), context())).results.map(({ id }) => id),
    ).toEqual(['eight-two-edits', 'seven-one-edit']);
  });

  it('keeps exact title and heading matches in the exact tier while highlighting passage text', async () => {
    const document = knowledgeSearchFixtureDocument({ id: 'metadata', title: 'Carrier Recovery' });
    const headingDocument = knowledgeSearchFixtureDocument({
      id: 'heading-metadata',
      title: 'Unrelated Metadata',
    });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(
      [document, headingDocument],
      [
        knowledgeSearchFixtureChunk(document, 'Recover the carrier after validation.', {
          id: 'metadata-passage',
          headingId: 'heading-1',
          heading: 'Carrier Recovery',
        }),
        knowledgeSearchFixtureChunk(headingDocument, 'Validate the carrier after restoration.', {
          id: 'heading-only-passage',
          headingId: 'heading-2',
          heading: 'Carrier Recovery',
        }),
      ],
    );

    const results = (await engine.search(request('carrier recovery'), context())).results;
    expect(results[0]).toMatchObject({
      id: 'metadata-passage',
      matchKind: 'exact',
      highlightText: 'carrier',
      score: 550,
    });
    expect(results[1]).toMatchObject({
      id: 'heading-only-passage',
      matchKind: 'exact',
      highlightText: 'carrier',
      score: 540,
    });
  });

  it('sorts final ties deterministically', async () => {
    const documents = ['z-document', 'a-document'].map((id) =>
      knowledgeSearchFixtureDocument({ id, title: 'Shared Title' }),
    );
    const chunks = documents.flatMap((document) => [
      knowledgeSearchFixtureChunk(document, 'shared phrase', {
        id: `${document.id}-second`,
        pageNumber: 2,
        passageNumber: 1,
      }),
      knowledgeSearchFixtureChunk(document, 'shared phrase', {
        id: `${document.id}-first-b`,
        pageNumber: 1,
        passageNumber: 2,
        normalizedStart: 50,
      }),
      knowledgeSearchFixtureChunk(document, 'shared phrase', {
        id: `${document.id}-first-a`,
        pageNumber: 1,
        passageNumber: 1,
      }),
    ]);
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(documents, chunks.toReversed());

    expect(
      (await engine.search(request('shared phrase'), context())).results.map(({ id }) => id),
    ).toEqual([
      'a-document-first-a',
      'a-document-first-b',
      'a-document-second',
      'z-document-first-a',
      'z-document-first-b',
      'z-document-second',
    ]);
  });

  it('collapses overlapping and adjacent passages on a page and caps each document at three', async () => {
    const document = knowledgeSearchFixtureDocument({ id: 'collapse', title: 'Collapse' });
    const chunks = [0, 16, 100, 200, 300].map((normalizedStart, index) =>
      knowledgeSearchFixtureChunk(document, `target passage ${index}`, {
        id: `passage-${index + 1}`,
        passageNumber: index + 1,
        normalizedStart,
      }),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);

    expect((await engine.search(request('target'), context())).results.map(({ id }) => id)).toEqual(
      ['passage-1', 'passage-3', 'passage-4'],
    );
  });

  it('applies document, category, document-type, and result-limit filters', async () => {
    const engine = relevanceEngine();
    const all = await engine.search(request('recovery'), context());
    expect(all.results.length).toBeGreaterThan(1);

    const scoped = await engine.search(
      request('recovery', {
        scope: { kind: 'document', documentId: 'noc-bgp-recovery' },
        limit: 1,
      }),
      context(),
    );
    expect(scoped.results.map(({ documentId }) => documentId)).toEqual(['noc-bgp-recovery']);

    const category = await engine.search(
      request('recovery', { categoryId: 'database' }),
      context(),
    );
    expect(category.results.map(({ documentId }) => documentId)).toEqual(['noc-oracle-database']);

    const type = await engine.search(
      request('recovery', { documentType: 'cheatsheet' }),
      context(),
    );
    expect(type.results.every(({ documentType }) => documentType === 'cheatsheet')).toBe(true);
  });

  it('rejects function-word-only queries', async () => {
    expect((await relevanceEngine().search(request('the and of'), context())).results).toEqual([]);
  });

  it('maps normalized page offsets back to original-casing excerpts with bounded ellipses', async () => {
    const document = knowledgeSearchFixtureDocument({ id: 'ranges', title: 'Ranges' });
    const prefix = 'Before '.repeat(30);
    const suffix = ' After'.repeat(30);
    const text = `${prefix}Cafe\u0301 FAILOVER${suffix}`;
    const chunk = knowledgeSearchFixtureChunk(document, text, { normalizedStart: 500 });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], [chunk]);

    const result = (await engine.search(request('café failover'), context())).results[0]!;
    expect(result.highlightText).toBe('café failover');
    expect(result.normalizedStart).toBe(
      500 + normalizeKnowledgeSearchText(text).indexOf('café failover'),
    );
    expect(result.normalizedEnd).toBe(result.normalizedStart + 'café failover'.length);
    expect(result.excerpt.startsWith('…')).toBe(true);
    expect(result.excerpt.endsWith('…')).toBe(true);
    expect(result.excerpt).toContain('Cafe\u0301 FAILOVER');
    expect(result.excerpt.length).toBeLessThanOrEqual(280);
  });
});

describe('KnowledgeSearchEngine snapshot mutations', () => {
  it('replaces, upserts, and removes documents and chunks without retaining stale postings', async () => {
    const first = knowledgeSearchFixtureDocument({ id: 'first', title: 'First' });
    const second = knowledgeSearchFixtureDocument({ id: 'second', title: 'Second' });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([first], [knowledgeSearchFixtureChunk(first, 'alpha target')]);
    expect((await engine.search(request('alpha'), context())).results).toHaveLength(1);

    engine.upsertDocument(second);
    engine.upsertChunk(knowledgeSearchFixtureChunk(second, 'beta target'));
    expect((await engine.search(request('beta'), context())).results[0]?.documentId).toBe('second');

    engine.removeChunk('second-page-1-passage-1');
    expect((await engine.search(request('beta'), context())).results).toEqual([]);
    engine.upsertChunk(knowledgeSearchFixtureChunk(second, 'gamma target'));
    engine.removeDocument('second');
    expect((await engine.search(request('gamma'), context())).results).toEqual([]);

    engine.replaceSnapshot([], []);
    expect((await engine.search(request('alpha'), context())).results).toEqual([]);
  });

  it('rejects chunks whose retained range normalization disagrees with normalizedText', () => {
    const document = knowledgeSearchFixtureDocument({ id: 'invalid', title: 'Invalid' });
    const chunk = knowledgeSearchFixtureChunk(document, 'Valid text');
    expect(() =>
      new KnowledgeSearchEngine().replaceSnapshot(
        [document],
        [{ ...chunk, normalizedText: 'invalid' }],
      ),
    ).toThrow(/normalizedText/u);
  });

  it('leaves the published snapshot intact when an incremental chunk is invalid', async () => {
    const document = knowledgeSearchFixtureDocument({ id: 'atomic', title: 'Atomic' });
    const chunk = knowledgeSearchFixtureChunk(document, 'stable target passage');
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], [chunk]);

    expect(() => engine.upsertChunk({ ...chunk, normalizedText: 'invalid' })).toThrow(
      /normalizedText/u,
    );
    expect((await engine.search(request('stable target'), context())).results).toHaveLength(1);
  });

  it('updates only affected metadata postings and retires stale checksums', async () => {
    const document = knowledgeSearchFixtureDocument({
      id: 'metadata-update',
      title: 'Legacy Procedure',
      category: 'Operations',
      categoryId: 'operations',
    });
    const chunk = knowledgeSearchFixtureChunk(document, 'neutral body content');
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], [chunk]);

    engine.upsertDocument({
      ...document,
      title: 'Modern Procedure',
      displayTitle: 'Modern Procedure',
      revision: 2,
    });
    expect((await engine.search(request('legacy procedure'), context())).results).toEqual([]);
    expect((await engine.search(request('modern procedure'), context())).results).toHaveLength(1);

    const nextChecksum = 'b'.repeat(64);
    engine.upsertDocument({
      ...document,
      checksum: nextChecksum,
      searchIndexChecksum: nextChecksum,
      revision: 3,
    });
    expect((await engine.search(request('neutral body'), context())).results).toEqual([]);
    engine.upsertChunk({ ...chunk, checksum: nextChecksum });
    expect((await engine.search(request('neutral body'), context())).results).toHaveLength(1);
  });

  it('uses an immutable query snapshot while concurrent mutations publish a new snapshot', async () => {
    const base = knowledgeSearchFixtureDocument({ id: 'base', title: 'Base' });
    const vocabulary = Array.from({ length: 250 }, (_, index) => {
      const suffix = `${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(
        97 + (index % 26),
      )}`;
      return knowledgeSearchFixtureChunk(base, `candidateword${suffix} target`, {
        id: `base-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      });
    });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([base], vocabulary);

    const pending = engine.search(request('candidatewordzz'), context());
    const added = knowledgeSearchFixtureDocument({ id: 'added', title: 'Added' });
    engine.upsertDocument(added);
    engine.upsertChunk(knowledgeSearchFixtureChunk(added, 'candidatewordzz'));

    const pendingResults = (await pending).results;
    expect(pendingResults.length).toBeGreaterThan(0);
    expect(pendingResults.every(({ documentId }) => documentId === 'base')).toBe(true);
    expect(
      (await engine.search(request('candidatewordzz'), context())).results[0]?.documentId,
    ).toBe('added');
  });

  it('copies caller-owned records into its immutable snapshot', async () => {
    const document = knowledgeSearchFixtureDocument({
      id: 'caller-owned',
      title: 'Original Title',
    });
    const chunk = knowledgeSearchFixtureChunk(document, 'Original target passage');
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], [chunk]);

    document.displayTitle = 'Mutated Title';
    document.title = 'Mutated Title';
    chunk.text = 'Mutated target passage';

    expect((await engine.search(request('original target'), context())).results[0]).toMatchObject({
      title: 'Original Title',
      excerpt: 'Original target passage',
    });
  });

  it('normalizes only affected chunks during representative sequential mutations', () => {
    const document = knowledgeSearchFixtureDocument({ id: 'incremental', title: 'Incremental' });
    const chunks = Array.from({ length: 1_000 }, (_, index) =>
      knowledgeSearchFixtureChunk(document, `target passage ${index}`, {
        id: `incremental-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      }),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    const updates = Array.from({ length: 50 }, (_, index) =>
      knowledgeSearchFixtureChunk(document, `updated target passage ${index}`, {
        id: `incremental-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      }),
    );
    const OriginalSegmenter = Intl.Segmenter;
    let normalizationPasses = 0;
    class CountingSegmenter extends OriginalSegmenter {
      constructor(...args: ConstructorParameters<typeof Intl.Segmenter>) {
        normalizationPasses += 1;
        super(...args);
      }
    }
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: CountingSegmenter });

    try {
      for (const update of updates) engine.upsertChunk(update);
      expect(normalizationPasses).toBe(100);

      normalizationPasses = 0;
      engine.upsertDocument({ ...document, displayTitle: 'Incremental Updated', revision: 2 });
      expect(normalizationPasses).toBe(3);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', {
        configurable: true,
        value: OriginalSegmenter,
      });
    }
  });

  it('rewrites shared metadata postings once per token during a document rename', () => {
    const document = knowledgeSearchFixtureDocument({
      id: 'metadata-batch',
      title: 'Legacy Procedure',
      category: 'Operations',
      categoryId: 'operations',
    });
    const chunks = Array.from({ length: 350 }, (_, index) =>
      knowledgeSearchFixtureChunk(document, `unique passage ${index}`, {
        id: `metadata-batch-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      }),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    const filterSpy = vi.spyOn(Array.prototype, 'filter');
    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    let filterInstances: unknown[] = [];
    let sortInstances: unknown[] = [];
    let sharedPostingFilters = 0;
    let sharedPostingSorts = 0;

    try {
      engine.upsertDocument({
        ...document,
        title: 'Modern Procedure',
        displayTitle: 'Modern Procedure',
        revision: 2,
      });
      filterInstances = [...filterSpy.mock.instances];
      sortInstances = [...sortSpy.mock.instances];
    } finally {
      filterSpy.mockRestore();
      sortSpy.mockRestore();
    }

    const isSharedPosting = (instance: unknown) =>
      Array.isArray(instance) &&
      instance.length > 0 &&
      instance.every((value) => typeof value === 'string' && value.startsWith('metadata-batch-'));
    sharedPostingFilters = filterInstances.filter(isSharedPosting).length;
    sharedPostingSorts = sortInstances.filter(isSharedPosting).length;

    expect(sharedPostingFilters).toBe(1);
    expect(sharedPostingSorts).toBeLessThanOrEqual(1);
  });
});

describe('KnowledgeSearchEngine cooperative cancellation and deadlines', () => {
  function largeEngine(kind: 'vocabulary' | 'passages'): KnowledgeSearchEngine {
    const document = knowledgeSearchFixtureDocument({ id: `large-${kind}`, title: 'Large Corpus' });
    const chunks = Array.from({ length: 350 }, (_, index) =>
      knowledgeSearchFixtureChunk(
        document,
        kind === 'vocabulary'
          ? `candidateword${String(index).padStart(4, '0')}`
          : `target passage ${index}`,
        { id: `${kind}-${index}`, passageNumber: index + 1, normalizedStart: index * 100 },
      ),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    return engine;
  }

  function commonPrefixEngine(): KnowledgeSearchEngine {
    const document = knowledgeSearchFixtureDocument({
      id: 'common-prefix',
      title: 'Common Prefix',
    });
    const chunks = Array.from({ length: 350 }, (_, index) => {
      const first = String.fromCharCode(97 + Math.floor(index / (26 * 26)));
      const second = String.fromCharCode(97 + (Math.floor(index / 26) % 26));
      const third = String.fromCharCode(97 + (index % 26));
      return knowledgeSearchFixtureChunk(document, `common${first}${second}${third}`, {
        id: `common-prefix-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      });
    });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    return engine;
  }

  function commonPostingEngine(): KnowledgeSearchEngine {
    const document = knowledgeSearchFixtureDocument({
      id: 'common-posting',
      title: 'Common Posting',
    });
    const chunks = Array.from({ length: 350 }, (_, index) =>
      knowledgeSearchFixtureChunk(document, 'rf target', {
        id: `common-posting-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      }),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    return engine;
  }

  function sparseSameLengthVocabularyEngine(): KnowledgeSearchEngine {
    const document = knowledgeSearchFixtureDocument({
      id: 'same-length',
      title: 'Sparse Vocabulary',
      category: 'Operations',
      categoryId: 'operations',
    });
    const chunks = Array.from({ length: 350 }, (_, index) => {
      const first = String.fromCharCode(97 + Math.floor(index / (26 * 26)));
      const second = String.fromCharCode(97 + (Math.floor(index / 26) % 26));
      const third = String.fromCharCode(97 + (index % 26));
      return knowledgeSearchFixtureChunk(document, `mnopq${first}${second}${third}`, {
        id: `same-length-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      });
    });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    return engine;
  }

  function denseSameLengthVocabularyEngine(): KnowledgeSearchEngine {
    const document = knowledgeSearchFixtureDocument({
      id: 'candidate-order',
      title: 'Candidate Ordering',
      category: 'Operations',
      categoryId: 'operations',
    });
    const chunks = Array.from({ length: 350 }, (_, index) => {
      const first = String.fromCharCode(97 + Math.floor(index / (26 * 26)));
      const second = String.fromCharCode(97 + (Math.floor(index / 26) % 26));
      const third = String.fromCharCode(97 + (index % 26));
      return knowledgeSearchFixtureChunk(document, `xabc${first}${second}${third}q`, {
        id: `candidate-order-${index}`,
        passageNumber: index + 1,
        normalizedStart: index * 100,
      });
    });
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot([document], chunks);
    return engine;
  }

  it.each(['vocabulary', 'passages'] as const)(
    'checks cancellation during %s work',
    async (kind) => {
      let checks = 0;
      await expect(
        largeEngine(kind).search(request(kind === 'vocabulary' ? 'candidateworz' : 'target'), {
          deadline: Infinity,
          isCancelled: () => ++checks >= 2,
        }),
      ).rejects.toMatchObject({ name: 'SearchCancelledError' });
    },
  );

  it('yields to the event loop so asynchronous cancellation can interrupt ranking', async () => {
    let cancelled = false;
    setImmediate(() => {
      cancelled = true;
    });

    await expect(
      largeEngine('passages').search(request('target'), {
        deadline: Infinity,
        isCancelled: () => cancelled,
      }),
    ).rejects.toMatchObject({ name: 'SearchCancelledError' });
  });

  it('yields during large common-prefix vocabulary expansion', async () => {
    let cancelled = false;
    let cancellationStack = '';
    setImmediate(() => {
      cancelled = true;
    });

    await expect(
      commonPrefixEngine().search(request('common'), {
        deadline: Infinity,
        isCancelled: () => {
          if (cancelled) cancellationStack = new Error().stack ?? '';
          return cancelled;
        },
      }),
    ).rejects.toMatchObject({ name: 'SearchCancelledError' });
    expect(cancellationStack).toContain('addPrefixVocabularyCandidates');
  });

  it('checks deadlines during large common-prefix vocabulary expansion', async () => {
    let reads = 0;
    let deadlineStack = '';
    await expect(
      commonPrefixEngine().search(request('common'), {
        get deadline() {
          reads += 1;
          if (reads === 2) deadlineStack = new Error().stack ?? '';
          return reads === 1 ? Infinity : -Infinity;
        },
        isCancelled: () => false,
      }),
    ).rejects.toMatchObject({ name: 'SearchTimeoutError' });
    expect(deadlineStack).toContain('addPrefixVocabularyCandidates');
  });

  it('yields while expanding a large exact posting', async () => {
    let cancelled = false;
    let cancellationStack = '';
    setImmediate(() => {
      cancelled = true;
    });

    await expect(
      commonPostingEngine().search(request('rf'), {
        deadline: Infinity,
        isCancelled: () => {
          if (cancelled) cancellationStack = new Error().stack ?? '';
          return cancelled;
        },
      }),
    ).rejects.toMatchObject({ name: 'SearchCancelledError' });
    expect(cancellationStack).toContain('candidateChunkIds');
  });

  it('checks deadlines while expanding a large exact posting', async () => {
    let reads = 0;
    let deadlineStack = '';
    await expect(
      commonPostingEngine().search(request('rf'), {
        get deadline() {
          reads += 1;
          if (reads === 2) deadlineStack = new Error().stack ?? '';
          return reads === 1 ? Infinity : -Infinity;
        },
        isCancelled: () => false,
      }),
    ).rejects.toMatchObject({ name: 'SearchTimeoutError' });
    expect(deadlineStack).toContain('candidateChunkIds');
  });

  it('yields while traversing a large same-length vocabulary bucket', async () => {
    let cancelled = false;
    let cancellationStack = '';
    setImmediate(() => {
      cancelled = true;
    });

    await expect(
      sparseSameLengthVocabularyEngine().search(request('zzzzzzzz'), {
        deadline: Infinity,
        isCancelled: () => {
          if (cancelled) cancellationStack = new Error().stack ?? '';
          return cancelled;
        },
      }),
    ).rejects.toMatchObject({ name: 'SearchCancelledError' });
    expect(cancellationStack).toContain('vocabularyAtAllowedLengths');
  });

  it('checks deadlines while traversing a large same-length vocabulary bucket', async () => {
    let reads = 0;
    let deadlineStack = '';
    await expect(
      sparseSameLengthVocabularyEngine().search(request('zzzzzzzz'), {
        get deadline() {
          reads += 1;
          if (reads === 2) deadlineStack = new Error().stack ?? '';
          return reads === 1 ? Infinity : -Infinity;
        },
        isCancelled: () => false,
      }),
    ).rejects.toMatchObject({ name: 'SearchTimeoutError' });
    expect(deadlineStack).toContain('vocabularyAtAllowedLengths');
  });

  it('yields while deterministically ordering a large fuzzy candidate set', async () => {
    let cancelled = false;
    let cancellationStack = '';
    setImmediate(() => {
      cancelled = true;
    });

    await expect(
      denseSameLengthVocabularyEngine().search(request('zabcdefg'), {
        deadline: Infinity,
        isCancelled: () => {
          const stack = new Error().stack ?? '';
          if (cancelled && stack.includes('orderedFuzzyCandidates')) {
            cancellationStack = stack;
            return true;
          }
          return false;
        },
      }),
    ).rejects.toMatchObject({ name: 'SearchCancelledError' });
    expect(cancellationStack).toContain('orderedFuzzyCandidates');
  });

  it('checks deadlines while deterministically ordering a large fuzzy candidate set', async () => {
    let deadlineStack = '';
    await expect(
      denseSameLengthVocabularyEngine().search(request('zabcdefg'), {
        get deadline() {
          const stack = new Error().stack ?? '';
          if (stack.includes('orderedFuzzyCandidates')) {
            deadlineStack = stack;
            return -Infinity;
          }
          return Infinity;
        },
        isCancelled: () => false,
      }),
    ).rejects.toMatchObject({ name: 'SearchTimeoutError' });
    expect(deadlineStack).toContain('orderedFuzzyCandidates');
  });

  it.each(['vocabulary', 'passages'] as const)('checks deadlines during %s work', async (kind) => {
    let reads = 0;
    const deadlineContext = {
      get deadline() {
        return ++reads === 1 ? Infinity : -Infinity;
      },
      isCancelled: () => false,
    };
    await expect(
      largeEngine(kind).search(
        request(kind === 'vocabulary' ? 'candidateworz' : 'target'),
        deadlineContext,
      ),
    ).rejects.toMatchObject({ name: 'SearchTimeoutError' });
  });

  it('completes a cached query over 20 synthetic documents in under 200ms', async () => {
    const documents = Array.from({ length: 20 }, (_, index) =>
      knowledgeSearchFixtureDocument({ id: `performance-${index}`, title: `Performance ${index}` }),
    );
    const chunks = documents.flatMap((document, documentIndex) =>
      Array.from({ length: 20 }, (_, passageIndex) =>
        knowledgeSearchFixtureChunk(
          document,
          `Router failover validation passage ${documentIndex} ${passageIndex} with operational details.`,
          {
            id: `${document.id}-${passageIndex}`,
            passageNumber: passageIndex + 1,
            normalizedStart: passageIndex * 100,
          },
        ),
      ),
    );
    const engine = new KnowledgeSearchEngine();
    engine.replaceSnapshot(documents, chunks);
    await engine.search(request('router failover'), context());

    const startedAt = performance.now();
    await engine.search(request('router failover'), context());
    expect(performance.now() - startedAt).toBeLessThan(200);
  });
});
