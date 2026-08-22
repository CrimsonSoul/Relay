#!/usr/bin/env node
/**
 * Compares Knowledge search index memory and search latency across revisions of
 * src/main/knowledge/KnowledgeSearchEngine.ts and src/shared/knowledgeSearch.ts.
 *
 *   node tests/benchmarks/knowledgeSearchBench.mjs [--rev <label>=<git-rev> ...]
 *
 * Each revision is materialised read-only into a temp directory with `git show`, never touching the
 * working tree, and measured in its own child process so retained heap is not cross-contaminated.
 * Defaults compare HEAD against the revision before per-chunk sourceRanges retention was removed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const ENGINE_PATH = 'src/main/knowledge/KnowledgeSearchEngine.ts';
const SHARED_PATH = 'src/shared/knowledgeSearch.ts';

// fb276afb removed per-chunk sourceRanges retention and hoisted Intl.Segmenter; its parent is the
// last revision that retained one range per normalized character of every indexed chunk.
const DEFAULT_REVISIONS = [
  ['before', 'fb276afb^'],
  ['head', 'HEAD'],
];

function parseArguments(argv) {
  const revisions = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--rev') {
      const [label, rev] = (argv[index + 1] ?? '').split('=');
      if (!label || !rev) throw new Error('--rev expects <label>=<git-rev>');
      revisions.push([label, rev]);
      index += 1;
    } else if (argument.startsWith('--') && argument.includes('=')) {
      const [key, value] = argument.slice(2).split('=');
      options[key] = Number.isNaN(Number(value)) ? value : Number(value);
    }
  }
  return { revisions: revisions.length > 0 ? revisions : DEFAULT_REVISIONS, options };
}

function show(revision, file) {
  // Developer-only benchmark: revisions come from the caller, and git is resolved from PATH the
  // same way every other script in this repo resolves its tools.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync('git', ['show', `${revision}:${file}`], {
    cwd: repoRoot,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
  });
}

/**
 * `<rev>` takes both files from one revision; `<engineRev>+<sharedRev>` mixes them, which is what
 * separates the sourceRanges change from the Intl.Segmenter hoist.
 */
function materialise(revision, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const [engineRevision, sharedRevision = engineRevision] = revision.split('+');
  const engine = show(engineRevision, ENGINE_PATH);
  const shared = show(sharedRevision, SHARED_PATH);
  // The only runtime alias in either file; the remaining `@shared/knowledge` import is type-only
  // and is erased by Node's type stripping.
  fs.writeFileSync(
    path.join(directory, 'KnowledgeSearchEngine.ts'),
    engine.replace("'@shared/knowledgeSearch'", "'./knowledgeSearch.ts'"),
  );
  fs.writeFileSync(path.join(directory, 'knowledgeSearch.ts'), shared);
}

function measure(label, directory, options) {
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--max-old-space-size=8192',
      '--experimental-strip-types',
      '--no-warnings',
      path.join(here, 'knowledgeSearchWorker.mjs'),
      directory,
      JSON.stringify(options),
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} worker exited with ${result.status}`);
  }
  const line = result.stdout.trim().split('\n').at(-1);
  return { label, ...JSON.parse(line) };
}

const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
const ms = (value) => `${value.toFixed(2)} ms`;

const { revisions, options } = parseArguments(process.argv.slice(2));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-knowledge-search-bench-'));
const measurements = [];

try {
  for (const [label, revision] of revisions) {
    const directory = path.join(workspace, label);
    materialise(revision, directory);
    process.stderr.write(`Measuring ${label} (${revision})...\n`);
    measurements.push(measure(label, directory, options));
  }
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

const [first] = measurements;
process.stdout.write(
  `\nCorpus: ${first.documents} documents x ${first.chunks / first.documents} chunks ` +
    `= ${first.chunks} chunks, ${(first.totalTextChars / 1e6).toFixed(1)}M source characters\n` +
    `Queries: ${first.searchCount} searches per variant, ${first.totalResults} results returned\n\n`,
);

const rows = measurements.map((entry) => ({
  variant: entry.label,
  'heap after index': mib(entry.heapIndexedBytes),
  'index overhead': mib(entry.indexOverheadBytes),
  'corpus only': mib(entry.heapCorpusBytes),
  'index build': ms(entry.indexMs),
  'search mean': ms(entry.searchMeanMs),
  'search p50': ms(entry.searchMedianMs),
  'search p95': ms(entry.searchP95Ms),
  'search total': ms(entry.searchTotalMs),
}));
console.table(rows);

if (measurements.length === 2) {
  const [before, after] = measurements;
  const delta = (label, key, unit) => {
    const change = after[key] - before[key];
    const percent = before[key] === 0 ? 0 : (change / before[key]) * 100;
    const rendered = unit === 'bytes' ? mib(Math.abs(change)) : ms(Math.abs(change));
    return `${label}: ${change <= 0 ? '-' : '+'}${rendered} (${percent.toFixed(1)}%)`;
  };
  process.stdout.write(
    `\n${after.label} vs ${before.label}\n` +
      `  ${delta('retained heap after indexing', 'heapIndexedBytes', 'bytes')}\n` +
      `  ${delta('index build time', 'indexMs', 'ms')}\n` +
      `  ${delta('mean search latency', 'searchMeanMs', 'ms')}\n` +
      `  ${delta('total search time', 'searchTotalMs', 'ms')}\n`,
  );
  if (
    before.totalResults !== after.totalResults ||
    before.totalExcerptChars !== after.totalExcerptChars
  ) {
    process.stdout.write(
      `\nWARNING: variants returned different work (results ${before.totalResults} vs ` +
        `${after.totalResults}, excerpt chars ${before.totalExcerptChars} vs ${after.totalExcerptChars})\n`,
    );
  } else {
    process.stdout.write(
      `\nBoth variants returned identical results (${after.totalResults} results, ` +
        `${after.totalExcerptChars} excerpt characters), so the comparison is like for like.\n`,
    );
  }
}
