/**
 * Measures one variant of the Knowledge search engine in its own process.
 *
 * argv[2] = directory holding `KnowledgeSearchEngine.ts` and `knowledgeSearch.ts` for the variant.
 * argv[3] = JSON options ({ documentCount, chunksPerDocument, searchRepeats }).
 *
 * Must be run with --expose-gc so retained heap can be measured after a forced collection.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { BENCH_QUERIES, buildCorpus } from './knowledgeSearchCorpus.mjs';

const variantDir = process.argv[2];
const options = JSON.parse(process.argv[3] ?? '{}');
const searchRepeats = options.searchRepeats ?? 5;

if (typeof globalThis.gc !== 'function') {
  throw new Error('knowledgeSearchWorker requires --expose-gc');
}

const importVariant = (file) => import(pathToFileURL(path.join(variantDir, file)).href);

const { KnowledgeSearchEngine } = await importVariant('KnowledgeSearchEngine.ts');
const { normalizeKnowledgeSearchText } = await importVariant('knowledgeSearch.ts');

/** V8 needs several passes before weakly held generations are actually released. */
function settle() {
  for (let pass = 0; pass < 6; pass += 1) globalThis.gc();
  return process.memoryUsage().heapUsed;
}

const baselineHeap = settle();

const { documents, chunks, totalTextChars } = buildCorpus(normalizeKnowledgeSearchText, options);
const corpusHeap = settle();

const engine = new KnowledgeSearchEngine();
const indexStart = process.hrtime.bigint();
engine.replaceSnapshot(documents, chunks);
const indexMs = Number(process.hrtime.bigint() - indexStart) / 1e6;

const indexedHeap = settle();

const context = () => ({ deadline: Date.now() + 60_000, isCancelled: () => false });
const request = (query, index) => ({
  requestId: `bench-${index}`,
  query,
  scope: { kind: 'all' },
  categoryId: null,
  documentType: null,
  limit: 20,
});

// Warm up so JIT and the first-call Segmenter construction are not attributed to a single query.
for (const [index, query] of BENCH_QUERIES.entries()) {
  await engine.search(request(query, `warm-${index}`), context());
}

const durations = [];
let totalResults = 0;
let totalExcerptChars = 0;
for (let round = 0; round < searchRepeats; round += 1) {
  for (const [index, query] of BENCH_QUERIES.entries()) {
    const start = process.hrtime.bigint();
    const response = await engine.search(request(query, `${round}-${index}`), context());
    durations.push(Number(process.hrtime.bigint() - start) / 1e6);
    totalResults += response.results.length;
    for (const result of response.results) totalExcerptChars += result.excerpt.length;
  }
}

const searchHeap = settle();
durations.sort((left, right) => left - right);
const at = (fraction) =>
  durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))];

process.stdout.write(
  `${JSON.stringify({
    variantDir,
    documents: documents.length,
    chunks: chunks.length,
    totalTextChars,
    indexMs,
    heapBaselineBytes: baselineHeap,
    heapCorpusBytes: corpusHeap,
    heapIndexedBytes: indexedHeap,
    heapAfterSearchBytes: searchHeap,
    indexOverheadBytes: indexedHeap - corpusHeap,
    searchCount: durations.length,
    searchTotalMs: durations.reduce((sum, value) => sum + value, 0),
    searchMeanMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    searchMedianMs: at(0.5),
    searchP95Ms: at(0.95),
    searchMaxMs: durations.at(-1),
    totalResults,
    totalExcerptChars,
  })}\n`,
);
