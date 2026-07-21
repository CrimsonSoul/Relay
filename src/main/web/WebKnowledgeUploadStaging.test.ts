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

  it('cleans abandoned staging data when a new gateway starts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'relay-web-knowledge-'));
    await writeFile(join(rootDir, 'abandoned.pdf'), '%PDF-old');

    await prepareWebKnowledgeUploadRoot(rootDir);

    expect(await missing(join(rootDir, 'abandoned.pdf'))).toBe(true);
  });
});
