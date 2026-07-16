import { createHash } from 'node:crypto';
import { mkdtemp, open, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_MAX_PDF_BYTES, KNOWLEDGE_UPLOAD_CHUNK_BYTES } from '@shared/knowledge';
import {
  KnowledgeSourceError,
  inspectKnowledgePdfCandidate,
  planKnowledgePdfSource,
  readKnowledgePdfChunk,
  revalidateKnowledgePdfSource,
} from '../knowledgeChunking';

const cleanup: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'relay-knowledge-chunks-'));
  cleanup.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('knowledgeChunking', () => {
  it('streams a checksum and plans a smaller final chunk without reading the whole PDF', async () => {
    const directory = await tempDirectory();
    const path = join(directory, 'Runbook.pdf');
    const bytes = new Uint8Array(KNOWLEDGE_UPLOAD_CHUNK_BYTES + 9).fill(7);
    bytes.set(Buffer.from('%PDF-'), 0);
    await writeFile(path, bytes);

    const candidate = await inspectKnowledgePdfCandidate(path);
    const plan = await planKnowledgePdfSource(candidate);

    expect(plan).toMatchObject({
      canonicalPath: await realpath(path),
      fileName: 'Runbook.pdf',
      byteSize: bytes.byteLength,
      chunkCount: 2,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
    await expect(readKnowledgePdfChunk(plan, 0)).resolves.toHaveLength(
      KNOWLEDGE_UPLOAD_CHUNK_BYTES,
    );
    await expect(readKnowledgePdfChunk(plan, 1)).resolves.toEqual(bytes.slice(-9));
  });

  it('handles the exact four MiB boundary as one bounded chunk', async () => {
    const directory = await tempDirectory();
    const path = join(directory, 'Exact.pdf');
    const bytes = new Uint8Array(KNOWLEDGE_UPLOAD_CHUNK_BYTES).fill(4);
    bytes.set(Buffer.from('%PDF-'), 0);
    await writeFile(path, bytes);

    const plan = await planKnowledgePdfSource(await inspectKnowledgePdfCandidate(path));

    expect(plan.chunkCount).toBe(1);
    await expect(readKnowledgePdfChunk(plan, 0)).resolves.toHaveLength(
      KNOWLEDGE_UPLOAD_CHUNK_BYTES,
    );
    await expect(readKnowledgePdfChunk(plan, 1)).rejects.toMatchObject({ code: 'invalid-file' });
  });

  it('accepts the 50 MiB maximum without allocating the entire source in the planner', async () => {
    const directory = await tempDirectory();
    const path = join(directory, 'Maximum.pdf');
    const handle = await open(path, 'w');
    try {
      await handle.write(Buffer.from('%PDF-'), 0, 5, 0);
      await handle.truncate(KNOWLEDGE_MAX_PDF_BYTES);
    } finally {
      await handle.close();
    }

    const plan = await planKnowledgePdfSource(await inspectKnowledgePdfCandidate(path));

    expect(plan.byteSize).toBe(KNOWLEDGE_MAX_PDF_BYTES);
    expect(plan.chunkCount).toBe(13);
  });

  it.each([
    ['empty PDF', new Uint8Array(), 'Empty.pdf'],
    ['invalid signature', Buffer.from('not-pdf'), 'Invalid.pdf'],
    ['wrong extension', Buffer.from('%PDF-test'), 'Runbook.txt'],
  ])('rejects an %s candidate', async (_label, bytes, fileName) => {
    const directory = await tempDirectory();
    const path = join(directory, fileName);
    await writeFile(path, bytes);

    await expect(inspectKnowledgePdfCandidate(path)).rejects.toBeInstanceOf(KnowledgeSourceError);
  });

  it('rejects symbolic links before following them', async () => {
    const directory = await tempDirectory();
    const target = join(directory, 'Target.pdf');
    const link = join(directory, 'Link.pdf');
    await writeFile(target, '%PDF-test');
    await symlink(target, link);

    await expect(inspectKnowledgePdfCandidate(link)).rejects.toMatchObject({
      code: 'invalid-file',
    });
  });

  it('detects changed or replaced sources before a resumed chunk read', async () => {
    const directory = await tempDirectory();
    const path = join(directory, 'Changed.pdf');
    await writeFile(path, '%PDF-original');
    const plan = await planKnowledgePdfSource(await inspectKnowledgePdfCandidate(path));
    await writeFile(path, '%PDF-replaced-with-different-content');

    await expect(revalidateKnowledgePdfSource(plan)).resolves.toBe(false);
    await expect(readKnowledgePdfChunk(plan, 0)).rejects.toMatchObject({
      code: 'source-required',
    });
  });
});
