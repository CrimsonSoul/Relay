import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  prepareWebKnowledgeUploadRoot,
  WebKnowledgeStagingError,
  WebKnowledgeUploadStaging,
} from './WebKnowledgeUploadStaging';

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

async function chunks(...values: string[]): Promise<AsyncIterable<Uint8Array>> {
  return (async function* () {
    for (const value of values) yield new TextEncoder().encode(value);
  })();
}

describe('WebKnowledgeUploadStaging', () => {
  it('streams ordered PDF bytes into private files before queueing validated paths', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-'));
    const queuePaths = vi.fn(async () => ({ ok: true, uploads: [] }) as const);
    const staging = new WebKnowledgeUploadStaging({
      rootDir,
      sessionId: 'session-a',
      localSourceId: 'web-session-a',
      queuePaths,
      createId: vi.fn().mockReturnValueOnce('batch-a').mockReturnValueOnce('file-a'),
    });

    const batch = await staging.begin([{ name: 'Runbook.pdf', size: 12 }]);
    await staging.append({
      fileId: batch.files[0]!.id,
      offset: 0,
      contentType: 'application/octet-stream',
      contentLength: 5,
      body: await chunks('%PDF-'),
    });
    await staging.append({
      fileId: batch.files[0]!.id,
      offset: 5,
      contentType: 'application/octet-stream',
      contentLength: 7,
      body: await chunks('first', '!!'),
    });

    await expect(staging.commit(batch.batchId)).resolves.toEqual({ ok: true, uploads: [] });
    const queuedPath = queuePaths.mock.calls[0]![0][0]!;
    expect(await readFile(queuedPath, 'utf8')).toBe('%PDF-first!!');
    expect(queuePaths).toHaveBeenCalledWith([queuedPath], 'web-session-a');

    await staging.dispose();
    expect(await missing(join(rootDir, 'session-a'))).toBe(true);
  });

  it('carries a replacement target into the durable upload queue', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-replacement-'));
    const queuePaths = vi.fn(async () => ({ ok: true, uploads: [] }) as const);
    const staging = new WebKnowledgeUploadStaging({
      rootDir,
      sessionId: 'session-replacement',
      localSourceId: 'web-session-replacement',
      queuePaths,
      createId: vi.fn().mockReturnValueOnce('batch-replacement').mockReturnValueOnce('file-1'),
    });

    const batch = await staging.begin(
      [{ name: 'Different Filename.pdf', size: 12 }],
      'document-target',
    );
    await staging.append({
      fileId: batch.files[0]!.id,
      offset: 0,
      contentType: 'application/octet-stream',
      contentLength: 12,
      body: await chunks('%PDF-first!!'),
    });
    await staging.commit(batch.batchId);

    expect(queuePaths).toHaveBeenCalledWith(
      [expect.stringContaining('Different Filename.pdf')],
      'web-session-replacement',
      'document-target',
    );
    await staging.dispose();
  });

  it('accepts consecutive committed uploads in one browser session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-consecutive-'));
    const queuePaths = vi.fn(async () => ({ ok: true, uploads: [] }) as const);
    const staging = new WebKnowledgeUploadStaging({
      rootDir,
      sessionId: 'session-consecutive',
      localSourceId: 'web-session-consecutive',
      queuePaths,
      createId: vi
        .fn()
        .mockReturnValueOnce('batch-first')
        .mockReturnValueOnce('file-first')
        .mockReturnValueOnce('batch-second')
        .mockReturnValueOnce('file-second'),
    });

    const first = await staging.begin([{ name: 'First.pdf', size: 12 }]);
    await staging.append({
      fileId: first.files[0]!.id,
      offset: 0,
      contentType: 'application/octet-stream',
      contentLength: 12,
      body: await chunks('%PDF-first!!'),
    });
    await staging.commit(first.batchId);
    const firstPath = queuePaths.mock.calls[0]![0][0]!;

    const second = await staging.begin([{ name: 'Second.pdf', size: 13 }]);
    await staging.append({
      fileId: second.files[0]!.id,
      offset: 0,
      contentType: 'application/octet-stream',
      contentLength: 13,
      body: await chunks('%PDF-second!!'),
    });
    await staging.commit(second.batchId);
    const secondPath = queuePaths.mock.calls[1]![0][0]!;

    expect(queuePaths).toHaveBeenCalledTimes(2);
    expect(firstPath).not.toBe(secondPath);
    expect(await missing(firstPath)).toBe(true);
    expect(await readFile(secondPath, 'utf8')).toBe('%PDF-second!!');
    await staging.dispose();
  });

  it('rejects unordered or oversized chunks and removes the partial batch', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-'));
    const staging = new WebKnowledgeUploadStaging({
      rootDir,
      sessionId: 'session-b',
      localSourceId: 'web-session-b',
      queuePaths: vi.fn(),
      createId: vi.fn().mockReturnValueOnce('batch-b').mockReturnValueOnce('file-b'),
    });
    const batch = await staging.begin([{ name: 'Runbook.pdf', size: 12 }]);

    await expect(
      staging.append({
        fileId: batch.files[0]!.id,
        offset: 1,
        contentType: 'application/octet-stream',
        contentLength: 5,
        body: await chunks('%PDF-'),
      }),
    ).rejects.toMatchObject<WebKnowledgeStagingError>({ code: 'invalid-request' });
    expect(await missing(join(rootDir, 'session-b'))).toBe(true);
  });

  it('validates file declarations and PDF content before queue ownership transfers', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-'));
    const queuePaths = vi.fn();
    const staging = new WebKnowledgeUploadStaging({
      rootDir,
      sessionId: 'session-c',
      localSourceId: 'web-session-c',
      queuePaths,
      createId: vi.fn().mockReturnValueOnce('batch-c').mockReturnValueOnce('file-c'),
    });

    await expect(staging.begin([{ name: '../escape.pdf', size: 12 }])).rejects.toMatchObject({
      code: 'invalid-file',
    });
    await expect(staging.begin([{ name: 'Unsafe\u0007Name.pdf', size: 12 }])).rejects.toMatchObject(
      {
        code: 'invalid-file',
      },
    );
    const batch = await staging.begin([{ name: 'Runbook.pdf', size: 6 }]);
    await staging.append({
      fileId: batch.files[0]!.id,
      offset: 0,
      contentType: 'application/octet-stream',
      contentLength: 6,
      body: await chunks('notpdf'),
    });
    await expect(staging.commit(batch.batchId)).rejects.toMatchObject({ code: 'invalid-file' });
    expect(queuePaths).not.toHaveBeenCalled();
    expect(await missing(join(rootDir, 'session-c'))).toBe(true);
  });

  it('accepts a maximum-length PDF filename measured in Unicode code points', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-unicode-'));
    const staging = new WebKnowledgeUploadStaging({
      rootDir,
      sessionId: 'session-unicode',
      localSourceId: 'web-session-unicode',
      queuePaths: vi.fn(),
      createId: vi.fn().mockReturnValueOnce('batch-unicode').mockReturnValueOnce('file-unicode'),
    });
    const fileName = `${'a'.repeat(235)}😀.pdf`;

    await expect(staging.begin([{ name: fileName, size: 12 }])).resolves.toMatchObject({
      files: [{ name: fileName }],
    });

    await staging.dispose();
  });

  it('cleans abandoned staging data when a new gateway starts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-'));
    await writeFile(join(rootDir, 'abandoned.pdf'), '%PDF-old');

    await prepareWebKnowledgeUploadRoot(rootDir);

    expect(await missing(join(rootDir, 'abandoned.pdf'))).toBe(true);
  });
});
