#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_FILE_BYTES = 16 * 1024;
const CHUNK_BYTES = 4 * 1024 * 1024;
const CONCURRENCY = 2;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

function integerArgument(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

export function parseKnowledgeUploadSoakArgs(args) {
  let full = false;
  let fileCount = MAX_FILES;
  let requestedBytes = null;
  for (const argument of args) {
    if (argument === '--full') full = true;
    else if (argument.startsWith('--files=')) {
      fileCount = integerArgument(argument.slice('--files='.length), 'File count');
    } else if (argument.startsWith('--bytes=')) {
      requestedBytes = integerArgument(argument.slice('--bytes='.length), 'File bytes');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (fileCount < 1 || fileCount > MAX_FILES) {
    throw new Error('File count must be between 1 and 100');
  }
  const fileBytes = requestedBytes ?? (full ? MAX_FILE_BYTES : DEFAULT_FILE_BYTES);
  if (!full && fileBytes === MAX_FILE_BYTES) throw new Error('50 MiB fixtures require --full');
  if (fileBytes < 1_024 || fileBytes > MAX_FILE_BYTES) {
    throw new Error('File bytes must be between 1 KiB and 50 MiB');
  }
  return { full, fileCount, fileBytes };
}

export function createKnowledgeUploadSoakManifest({ fileCount, fileBytes }) {
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > MAX_FILES) {
    throw new Error('File count must be between 1 and 100');
  }
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 1_024 || fileBytes > MAX_FILE_BYTES) {
    throw new Error('File bytes must be between 1 KiB and 50 MiB');
  }
  return Array.from({ length: fileCount }, (_, index) => ({
    fileName: `relay-soak-${String(index + 1).padStart(3, '0')}.pdf`,
    byteSize: fileBytes,
    seed: index + 1,
  }));
}

export function createKnowledgeCatalogSoakFixture() {
  const categories = Array.from({ length: 10 }, (_, index) => ({
    id: `category_${index + 1}`,
    name: `Category ${String(index + 1).padStart(2, '0')}`,
    sortOrder: (index + 1) * 100,
  }));
  const documents = Array.from({ length: 100 }, (_, index) => ({
    id: `doc_${String(index + 1).padStart(3, '0')}`,
    categoryId: `category_${(index % 10) + 1}`,
    documentType: index < 70 ? 'sop' : 'cheatsheet',
  }));
  return { categories, documents };
}

function pdfBytes(seed) {
  const title = `Relay upload soak ${String(seed).padStart(3, '0')}`;
  const stream = `BT /F1 16 Tf 72 720 Td (${title}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((value, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

async function writeDeterministicPdf(path, byteSize, seed) {
  const base = pdfBytes(seed);
  if (base.byteLength > byteSize) throw new Error('Requested soak PDF is too small');
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'w', 0o600);
  const padding = Buffer.alloc(Math.min(1024 * 1024, byteSize - base.byteLength), 0x20);
  try {
    await handle.write(base);
    let remaining = byteSize - base.byteLength;
    while (remaining > 0) {
      const length = Math.min(remaining, padding.byteLength);
      await handle.write(padding.subarray(0, length));
      remaining -= length;
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: CHUNK_BYTES })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function readChunk(path, index, byteSize) {
  const start = index * CHUNK_BYTES;
  const length = Math.min(CHUNK_BYTES, byteSize - start);
  const bytes = Buffer.alloc(length);
  const handle = await open(path, 'r');
  try {
    const result = await handle.read(bytes, 0, length, start);
    if (result.bytesRead !== length) throw new Error('Short soak chunk read');
    return bytes;
  } finally {
    await handle.close();
  }
}

async function runBounded(tasks, concurrency) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      await task();
    }
  });
  await Promise.all(workers);
}

async function exerciseKnowledgeCatalogSoak() {
  const fixture = createKnowledgeCatalogSoakFixture();
  const coverCache = new Map();
  let activeCoverJobs = 0;
  let peakCoverConcurrency = 0;
  let coverCacheHits = 0;
  let maxCoverBytes = 0;

  const loadCover = async (document, index) => {
    if (coverCache.has(document.id)) {
      coverCacheHits += 1;
      return;
    }
    activeCoverJobs += 1;
    peakCoverConcurrency = Math.max(peakCoverConcurrency, activeCoverJobs);
    try {
      await Promise.resolve();
      const byteLength = 96 * 1024 + index * 1024;
      if (byteLength > MAX_COVER_BYTES) throw new Error('Catalog cover exceeds 2 MiB');
      coverCache.set(document.id, byteLength);
      maxCoverBytes = Math.max(maxCoverBytes, byteLength);
    } finally {
      activeCoverJobs -= 1;
    }
  };

  await runBounded(
    fixture.documents.map((document, index) => () => loadCover(document, index)),
    CONCURRENCY,
  );
  await runBounded(
    fixture.documents.map((document, index) => () => loadCover(document, index)),
    CONCURRENCY,
  );

  const deletedCategoryId = 'category_10';
  const replacementCategoryId = 'category_1';
  const remainingCategories = fixture.categories
    .filter(({ id }) => id !== deletedCategoryId)
    .toReversed()
    .map((category, index) => ({ ...category, sortOrder: (index + 1) * 100 }));
  const reassignedDocuments = fixture.documents.map((document) =>
    document.categoryId === deletedCategoryId
      ? { ...document, categoryId: replacementCategoryId }
      : document,
  );
  const remainingCategoryIds = new Set(remainingCategories.map(({ id }) => id));

  return {
    documentCount: fixture.documents.length,
    categoryCount: fixture.categories.length,
    categoriesAfterDelete: remainingCategories.length,
    sopCount: fixture.documents.filter(({ documentType }) => documentType === 'sop').length,
    cheatsheetCount: fixture.documents.filter(({ documentType }) => documentType === 'cheatsheet')
      .length,
    peakCoverConcurrency,
    coverCacheHits,
    maxCoverBytes,
    orphanedCategoryIds: reassignedDocuments.filter(
      ({ categoryId }) => !remainingCategoryIds.has(categoryId),
    ).length,
  };
}

async function combinedChunkChecksum(chunkPaths) {
  const hash = createHash('sha256');
  for (const path of chunkPaths) {
    for await (const chunk of createReadStream(path, { highWaterMark: CHUNK_BYTES })) {
      hash.update(chunk);
    }
  }
  return hash.digest('hex');
}

async function prepareRuntimeManifest(manifest, sourceRoot, metrics) {
  const runtimeManifest = [];
  for (const item of manifest) {
    const sourcePath = join(sourceRoot, item.fileName);
    await writeDeterministicPdf(sourcePath, item.byteSize, item.seed);
    runtimeManifest.push({
      ...item,
      sourcePath,
      checksum: await sha256File(sourcePath),
      chunkCount: Math.ceil(item.byteSize / CHUNK_BYTES),
    });
    metrics.peakMainProcessBytes = Math.max(
      metrics.peakMainProcessBytes,
      process.memoryUsage().rss,
    );
  }
  return runtimeManifest;
}

async function transferChunk(item, index, serverRoot, acknowledged, metrics) {
  const bytes = await readChunk(item.sourcePath, index, item.byteSize);
  const target = join(serverRoot, item.fileName, `${index}.part`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, { mode: 0o600 });
  acknowledged.get(item.fileName)?.add(index);
  metrics.serverBytes += bytes.byteLength;
  metrics.serverStorageHighWaterBytes = Math.max(
    metrics.serverStorageHighWaterBytes,
    metrics.serverBytes,
  );
  metrics.peakMainProcessBytes = Math.max(metrics.peakMainProcessBytes, process.memoryUsage().rss);
}

function transferTasks(runtimeManifest, serverRoot, acknowledged, metrics) {
  const tasks = [];
  for (const item of runtimeManifest) {
    for (let index = 0; index < item.chunkCount; index += 1) {
      const isAcknowledged = acknowledged.get(item.fileName)?.has(index) === true;
      if (isAcknowledged) continue;
      tasks.push(() => transferChunk(item, index, serverRoot, acknowledged, metrics));
    }
  }
  return tasks;
}

async function verifyStagedFiles(runtimeManifest, serverRoot) {
  let stagedFiles = 0;
  let checksumFailures = 0;
  for (const item of runtimeManifest) {
    const chunkPaths = Array.from({ length: item.chunkCount }, (_, index) =>
      join(serverRoot, item.fileName, `${index}.part`),
    );
    if ((await combinedChunkChecksum(chunkPaths)) === item.checksum) stagedFiles += 1;
    else checksumFailures += 1;
  }
  return { stagedFiles, checksumFailures };
}

export async function runKnowledgeUploadSoak(options, dependencies = {}) {
  const manifest = createKnowledgeUploadSoakManifest(options);
  const startedAt = Date.now();
  const artifactRoot = await mkdtemp(
    join(options.tempRoot ?? tmpdir(), 'relay-knowledge-upload-soak-'),
  );
  dependencies.onArtifactRoot?.(artifactRoot);
  const sourceRoot = join(artifactRoot, 'source');
  const serverRoot = join(artifactRoot, 'server');
  const metrics = {
    peakMainProcessBytes: process.memoryUsage().rss,
    serverBytes: 0,
    serverStorageHighWaterBytes: 0,
  };
  let retries = 0;
  let result;
  try {
    const runtimeManifest = await prepareRuntimeManifest(manifest, sourceRoot, metrics);

    const acknowledged = new Map(runtimeManifest.map((item) => [item.fileName, new Set()]));
    acknowledged.get(runtimeManifest[0].fileName)?.add(0);
    const initialTasks = transferTasks(runtimeManifest, serverRoot, acknowledged, metrics);
    acknowledged.get(runtimeManifest[0].fileName)?.delete(0);
    retries += 1;
    await runBounded(initialTasks, CONCURRENCY);
    await runBounded(
      transferTasks(runtimeManifest, serverRoot, acknowledged, metrics),
      CONCURRENCY,
    );

    const { stagedFiles, checksumFailures } = await verifyStagedFiles(runtimeManifest, serverRoot);
    const catalog = await exerciseKnowledgeCatalogSoak();
    result = {
      fileCount: manifest.length,
      stagedFiles,
      totalBytes: manifest.reduce((total, item) => total + item.byteSize, 0),
      elapsedMs: Date.now() - startedAt,
      retries,
      checksumFailures,
      peakMainProcessBytes: metrics.peakMainProcessBytes,
      serverStorageHighWaterBytes: metrics.serverStorageHighWaterBytes,
      catalog,
    };
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
  return { ...result, artifactCleaned: true };
}

async function main() {
  const options = parseKnowledgeUploadSoakArgs(process.argv.slice(2));
  const summary = await runKnowledgeUploadSoak(options);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Knowledge soak failed'}\n`);
    process.exitCode = 1;
  });
}
