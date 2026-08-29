import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_UPLOAD_MAX_FILES } from '@shared/knowledge';
import { createWindowsPrivateDirectory } from '../../pocketbase/WindowsPrivateDirectory';
import {
  KNOWLEDGE_UPLOAD_MAX_QUEUE_ENTRIES,
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
    version: 2,
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
        replacementDocumentId: 'document-target',
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
  it('atomically persists encrypted source paths with host-private permissions', async () => {
    const parent = await tempDirectory();
    const dataDir = join(parent, 'private');
    if (process.platform === 'win32') createWindowsPrivateDirectory(dataDir);
    else await mkdir(dataDir, { mode: 0o700 });
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
    expect(JSON.parse(persisted)).toMatchObject({ version: 2 });
    expect(persisted).not.toContain('/Users/publisher/Documents');
    expect(persisted).not.toContain('Runbook.pdf%PDF-');
    expect(persisted).toContain('encryptedSourcePath');
    const persistedStats = await stat(store.path);
    expect(persistedStats.isFile()).toBe(true);
    if (process.platform !== 'win32') expect(persistedStats.mode & 0o777).toBe(0o600);
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

  it('migrates legacy version-one queues without dropping replacement intent', async () => {
    const dataDir = await tempDirectory();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf8'),
    };
    const store = new KnowledgeUploadQueueStore({ dataDir, safeStorage });
    await store.save(queue());
    const legacy = JSON.parse(await readFile(store.path, 'utf8')) as Record<string, unknown>;
    legacy.version = 1;
    await writeFile(store.path, JSON.stringify(legacy), 'utf8');

    await expect(store.load()).resolves.toEqual(queue());
  });

  it('persists pending cancellation intent without changing the queue schema version', async () => {
    const dataDir = await tempDirectory();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf8'),
    };
    const store = new KnowledgeUploadQueueStore({ dataDir, safeStorage });
    const pendingCancellation = queue();
    pendingCancellation.entries[0] = {
      ...pendingCancellation.entries[0]!,
      state: 'paused',
      cancelRequested: true,
    };

    await store.save(pendingCancellation);

    await expect(store.load()).resolves.toEqual(pendingCancellation);
    const persisted = JSON.parse(await readFile(store.path, 'utf8')) as {
      version: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(persisted.version).toBe(2);
    expect(persisted.entries[0]).toMatchObject({
      state: 'paused',
      cancelRequested: true,
    });
  });

  it('rejects persisted cancellation flags other than the optional true literal', async () => {
    const dataDir = await tempDirectory();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf8'),
    };
    const store = new KnowledgeUploadQueueStore({ dataDir, safeStorage });
    await store.save(queue());
    const persisted = JSON.parse(await readFile(store.path, 'utf8')) as {
      entries: Array<Record<string, unknown>>;
    };
    persisted.entries[0]!.cancelRequested = false;
    await writeFile(store.path, JSON.stringify(persisted), 'utf8');

    await expect(store.load()).resolves.toEqual(createEmptyKnowledgeUploadQueue(true));
  });

  it('restores multiple session batches beyond the per-batch file limit', async () => {
    const dataDir = await tempDirectory();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString('utf8'),
    };
    const store = new KnowledgeUploadQueueStore({ dataDir, safeStorage });
    const base = queue().entries[0]!;
    const multiSessionQueue: KnowledgeUploadQueueState = {
      version: 2,
      restartRecovery: true,
      entries: Array.from({ length: KNOWLEDGE_UPLOAD_MAX_FILES + 1 }, (_, index) => ({
        ...base,
        localId: `local-${index}`,
        batchRequestId: index < KNOWLEDGE_UPLOAD_MAX_FILES ? 'batch-a' : 'batch-b',
        batchId: index < KNOWLEDGE_UPLOAD_MAX_FILES ? 'server-batch-a' : 'server-batch-b',
        uploadId: `upload-${index}`,
        accountId: index < KNOWLEDGE_UPLOAD_MAX_FILES ? 'account-a' : 'account-b',
        source: {
          ...base.source,
          canonicalPath: `/private/work/${index}.pdf`,
          fileName: `${index}.pdf`,
        },
      })),
    };

    await store.save(multiSessionQueue);

    await expect(store.load()).resolves.toEqual(multiSessionQueue);
    expect(multiSessionQueue.entries.length).toBeLessThan(KNOWLEDGE_UPLOAD_MAX_QUEUE_ENTRIES);
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
