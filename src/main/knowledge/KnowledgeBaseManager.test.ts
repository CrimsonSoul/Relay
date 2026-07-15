import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import type { KnowledgeSourceCandidate, KnowledgeSourceScan } from './knowledgePathSafety';
import { KnowledgeBaseManager } from './KnowledgeBaseManager';

const source: KnowledgeSourceCandidate = {
  canonicalPath: '/relay/knowledge-base/Monitoring/Runbook.pdf',
  sourceKey: 'Monitoring/Runbook.pdf',
  category: 'Monitoring',
  fileName: 'Runbook.pdf',
  byteSize: 64,
  sourceModifiedAt: '2026-07-14T12:00:00.000Z',
};

function record(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
  return {
    id: 'document123',
    sourceKey: source.sourceKey,
    category: source.category,
    title: 'Runbook',
    fileName: source.fileName,
    pdf: 'runbook.pdf',
    checksum: 'a'.repeat(64),
    byteSize: source.byteSize,
    pageCount: 1,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: source.sourceModifiedAt,
    indexedAt: '2026-07-14T12:01:00.000Z',
    created: '2026-07-14T12:01:00.000Z',
    updated: '2026-07-14T12:01:00.000Z',
    ...overrides,
  };
}

describe('KnowledgeBaseManager', () => {
  const ensureRoot = vi.fn(async () => undefined);
  const scan = vi.fn<() => Promise<KnowledgeSourceScan>>();
  const readFile = vi.fn(async () => Buffer.from('%PDF-1.4 changed'));
  const checksum = vi.fn(() => 'b'.repeat(64));
  const extractor = {
    extract: vi.fn(async () => ({
      metadataTitle: 'Operations Runbook',
      pageCount: 3,
      outline: [{ id: 'overview', label: 'Overview', level: 1 as const, pageIndex: 0, top: 700 }],
      outlineSource: 'native' as const,
    })),
    stop: vi.fn(async () => undefined),
  };
  const getFullList = vi.fn();
  const create = vi.fn(async () => ({ id: 'created123' }));
  const update = vi.fn(async () => ({}));
  const remove = vi.fn(async () => true);
  const collection = { getFullList, create, update, delete: remove };
  const getPbClient = vi.fn(() => ({ collection: () => collection }) as never);
  const closeWatcher = vi.fn();
  let watcherChange: (() => void) | null = null;
  const watch = vi.fn((_root: string, onChange: () => void) => {
    watcherChange = onChange;
    return { close: closeWatcher };
  });
  const broadcastStatus = vi.fn();
  let now = Date.parse('2026-07-14T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    watcherChange = null;
    now = Date.parse('2026-07-14T12:00:00.000Z');
    scan.mockResolvedValue({ healthy: true, candidates: [source], issues: [] });
    getFullList.mockResolvedValue([]);
  });

  function manager() {
    return new KnowledgeBaseManager({
      root: '/relay/knowledge-base',
      getPbClient,
      extractor,
      ensureRoot,
      scan,
      readFile,
      checksum,
      watch,
      broadcastStatus,
      now: () => now,
    });
  }

  it('creates the root, indexes a PDF, and starts watcher and reconciliation resources', async () => {
    scan
      .mockResolvedValueOnce({
        healthy: false,
        candidates: [],
        issues: [],
        error: 'missing source root',
      })
      .mockResolvedValueOnce({ healthy: true, candidates: [source], issues: [] });
    const instance = manager();

    await instance.start();

    expect(ensureRoot).toHaveBeenCalledWith('/relay/knowledge-base');
    expect(extractor.extract).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    const payload = create.mock.calls[0]?.[0];
    expect(payload).toBeInstanceOf(FormData);
    expect((payload as FormData).get('title')).toBe('Operations Runbook');
    expect((payload as FormData).get('pdf')).toBeInstanceOf(Blob);
    expect(watch).toHaveBeenCalledOnce();
    expect(instance.getStatus()).toMatchObject({
      state: 'idle',
      documentCount: 1,
      categoryCount: 1,
    });
    await instance.stop();
  });

  it('skips reading, parsing, and uploading an unchanged source', async () => {
    getFullList.mockResolvedValue([record()]);
    const instance = manager();

    await instance.start();

    expect(readFile).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    await instance.stop();
  });

  it('updates the stable PocketBase record ID when a source checksum changes', async () => {
    getFullList.mockResolvedValue([
      record({ byteSize: 12, sourceModifiedAt: '2026-07-13T12:00:00.000Z' }),
    ]);
    const instance = manager();

    await instance.start();

    expect(update).toHaveBeenCalledWith('document123', expect.any(FormData));
    expect(create).not.toHaveBeenCalled();
    await instance.stop();
  });

  it('preserves mirrored records when the source root is unhealthy', async () => {
    getFullList.mockResolvedValue([record()]);
    scan.mockResolvedValue({ healthy: false, candidates: [], issues: [], error: 'unavailable' });
    const instance = manager();

    await instance.start();

    expect(ensureRoot).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(instance.getStatus()).toMatchObject({ state: 'warning', documentCount: 1 });
    await instance.stop();
  });

  it('does not treat invalid source entries as confirmed deletions', async () => {
    getFullList.mockResolvedValue([record()]);
    scan.mockResolvedValue({
      healthy: true,
      candidates: [],
      issues: [{ code: 'invalid-signature', sourceKey: source.sourceKey }],
    });
    const instance = manager();

    await instance.start();
    now += 5 * 60 * 1_000;
    await instance.reconcile();

    expect(remove).not.toHaveBeenCalled();
    expect(instance.getStatus()).toMatchObject({ state: 'warning', documentCount: 1 });
    await instance.stop();
  });

  it('requires the same bulk-missing set twice at least five minutes apart', async () => {
    const records = [
      record({ id: 'one', sourceKey: 'A.pdf' }),
      record({ id: 'two', sourceKey: 'B.pdf' }),
      record({ id: 'three', sourceKey: 'C.pdf' }),
      record({ id: 'four', sourceKey: 'D.pdf' }),
    ];
    getFullList.mockResolvedValue(records);
    scan.mockResolvedValue({ healthy: true, candidates: [], issues: [] });
    const instance = manager();

    await instance.start();
    expect(remove).not.toHaveBeenCalled();
    expect(instance.getStatus().state).toBe('warning');

    now += 5 * 60 * 1_000;
    await instance.reconcile();
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['one', 'two', 'three', 'four']);
    await instance.stop();
  });

  it('debounces watcher bursts into one reconciliation and closes resources on stop', async () => {
    vi.useFakeTimers();
    const instance = manager();
    await instance.start();
    expect(scan).toHaveBeenCalledOnce();

    watcherChange?.();
    watcherChange?.();
    watcherChange?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(scan).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(2);

    await instance.stop();
    expect(closeWatcher).toHaveBeenCalledOnce();
    expect(extractor.stop).toHaveBeenCalledOnce();
  });

  it('contains a failed reconciliation and reports it without rejecting background work', async () => {
    scan.mockRejectedValueOnce(new Error('source changed during scan'));
    const instance = manager();

    await expect(instance.start()).resolves.toBeUndefined();
    expect(instance.getStatus()).toMatchObject({
      state: 'error',
      message: 'Knowledge index refresh failed',
    });
    expect(watch).toHaveBeenCalledOnce();
    await instance.stop();
  });
});
