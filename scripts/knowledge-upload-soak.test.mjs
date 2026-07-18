import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeCatalogSoakFixture,
  createKnowledgeUploadSoakManifest,
  parseKnowledgeUploadSoakArgs,
  runKnowledgeUploadSoak,
} from './knowledge-upload-soak.mjs';

describe('knowledge upload soak', () => {
  it('builds a mixed 100-document catalog across ten stable categories', () => {
    const fixture = createKnowledgeCatalogSoakFixture();

    expect(fixture.categories).toHaveLength(10);
    expect(fixture.documents).toHaveLength(100);
    expect(fixture.documents.filter(({ documentType }) => documentType === 'sop')).toHaveLength(70);
    expect(
      fixture.documents.filter(({ documentType }) => documentType === 'cheatsheet'),
    ).toHaveLength(30);
    expect(new Set(fixture.documents.map(({ categoryId }) => categoryId)).size).toBe(10);
  });

  it('builds a deterministic bounded 100-file manifest by default', () => {
    const first = createKnowledgeUploadSoakManifest({ fileCount: 100, fileBytes: 16_384 });
    const second = createKnowledgeUploadSoakManifest({ fileCount: 100, fileBytes: 16_384 });

    expect(first).toEqual(second);
    expect(first).toHaveLength(100);
    expect(first[0]).toEqual({ fileName: 'relay-soak-001.pdf', byteSize: 16_384, seed: 1 });
    expect(first[99]).toEqual({ fileName: 'relay-soak-100.pdf', byteSize: 16_384, seed: 100 });
  });

  it('requires an explicit full flag before accepting 50 MiB fixtures', () => {
    expect(() => parseKnowledgeUploadSoakArgs(['--bytes=52428800'])).toThrow(
      '50 MiB fixtures require --full',
    );
    expect(parseKnowledgeUploadSoakArgs(['--full', '--files=2'])).toMatchObject({
      full: true,
      fileCount: 2,
      fileBytes: 50 * 1024 * 1024,
    });
    expect(() => parseKnowledgeUploadSoakArgs(['--files=101'])).toThrow(
      'File count must be between 1 and 100',
    );
  });

  it('resumes missing chunks, reports a bounded summary, and always cleans artifacts', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'relay-soak-test-'));
    let artifactRoot = '';
    try {
      const summary = await runKnowledgeUploadSoak(
        { full: false, fileCount: 4, fileBytes: 4_096, tempRoot: parent },
        { onArtifactRoot: (value) => (artifactRoot = value) },
      );

      expect(summary).toMatchObject({
        fileCount: 4,
        stagedFiles: 4,
        checksumFailures: 0,
        artifactCleaned: true,
      });
      expect(summary.retries).toBeGreaterThan(0);
      expect(summary.totalBytes).toBe(4 * 4_096);
      expect(summary.serverStorageHighWaterBytes).toBeGreaterThanOrEqual(summary.totalBytes);
      expect(summary.catalog).toMatchObject({
        documentCount: 100,
        categoryCount: 10,
        sopCount: 70,
        cheatsheetCount: 30,
        peakCoverConcurrency: 2,
        coverCacheHits: 100,
        orphanedCategoryIds: 0,
      });
      expect(summary.catalog.maxCoverBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(artifactRoot).not.toBe('');
      expect(await readdir(parent)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
