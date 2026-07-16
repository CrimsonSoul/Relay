import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KnowledgeUploadQueueStore,
  createEmptyKnowledgeUploadQueue,
  type KnowledgeUploadQueueState,
} from '../KnowledgeUploadQueueStore';

const cleanup: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'relay-upload-queue-'));
  cleanup.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function queue(): KnowledgeUploadQueueState {
  return {
    version: 1,
    restartRecovery: true,
    entries: [
      {
        localId: 'local-1',
        batchRequestId: 'batch-request-1',
        batchId: 'batch-1',
        batchRevision: 1,
        uploadId: 'upload-1',
        uploadRevision: 2,
        accountId: 'account-1',
        deviceId: 'device-1',
        source: {
          canonicalPath: '/Users/publisher/Documents/Runbook.pdf',
          fileName: 'Runbook.pdf',
          byteSize: 9,
          modifiedMs: 1_000,
          device: 10,
          inode: 20,
          checksum: 'a'.repeat(64),
          chunkCount: 1,
        },
        acknowledgedChunkIndexes: [0],
        state: 'paused-network',
        safeError: 'offline',
        retryCount: 8,
      },
    ],
  };
}

describe('KnowledgeUploadQueueStore', () => {
  it('atomically persists encrypted source paths with owner-only permissions', async () => {
    const dataDir = await tempDirectory();
    const safeStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`).reverse()),
      decryptString: vi.fn((value: Buffer) =>
        Buffer.from(value)
          .reverse()
          .toString('utf8')
          .replace(/^encrypted:/, ''),
      ),
    };
    const store = new KnowledgeUploadQueueStore({ dataDir, safeStorage });

    await store.save(queue());

    await expect(store.load()).resolves.toEqual(queue());
    const persisted = await readFile(store.path, 'utf8');
    expect(persisted).not.toContain('/Users/publisher/Documents');
    expect(persisted).not.toContain('Runbook.pdf%PDF-');
    expect(persisted).toContain('encryptedSourcePath');
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it('keeps an in-memory queue and disables restart recovery when safe storage is unavailable', async () => {
    const dataDir = await tempDirectory();
    const store = new KnowledgeUploadQueueStore({
      dataDir,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: vi.fn(),
        decryptString: vi.fn(),
      },
    });

    await store.save(queue());

    await expect(store.load()).resolves.toEqual({ ...queue(), restartRecovery: false });
    await expect(stat(store.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns an empty bounded queue when no persisted state exists', async () => {
    const dataDir = await tempDirectory();
    const store = new KnowledgeUploadQueueStore({
      dataDir,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString('utf8'),
      },
    });

    await expect(store.load()).resolves.toEqual(createEmptyKnowledgeUploadQueue(true));
  });
});
