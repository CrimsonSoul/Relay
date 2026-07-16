import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_LIBRARY_STATE_COLLECTION } from '@shared/knowledge';
import { ManagedKnowledgeMigration } from '../ManagedKnowledgeMigration';

const NOW = '2026-07-16T01:00:00.000Z';

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'document-1',
    title: 'Runbook',
    indexedAt: '2026-07-15T12:00:00.000Z',
    lifecycleState: '',
    displayTitle: '',
    revision: 0,
    ...overrides,
  };
}

describe('ManagedKnowledgeMigration', () => {
  const stateCollection = {
    getFirstListItem: vi.fn(),
    create: vi.fn(async (value) => ({ id: 'state-1', ...value })),
    update: vi.fn(async (_id, value) => ({ id: 'state-1', ...value })),
  };
  const documentCollection = {
    getFullList: vi.fn(async () => []),
    update: vi.fn(async (_id, value) => value),
  };
  const pb = {
    collection: vi.fn((name: string) =>
      name === KNOWLEDGE_LIBRARY_STATE_COLLECTION ? stateCollection : documentCollection,
    ),
  };
  const reconcileLegacy = vi.fn(async () => ({ healthy: true }));
  const scanLegacy = vi.fn(async () => ({ healthy: true, candidates: [], issues: [] }));

  beforeEach(() => {
    vi.clearAllMocks();
    stateCollection.getFirstListItem.mockRejectedValue(new Error('missing'));
    documentCollection.getFullList.mockResolvedValue([]);
    reconcileLegacy.mockResolvedValue({ healthy: true });
    scanLegacy.mockResolvedValue({ healthy: true, candidates: [], issues: [] });
  });

  function migration() {
    return new ManagedKnowledgeMigration({
      pb: pb as never,
      root: '/relay/data/knowledge-base',
      now: () => Date.parse(NOW),
      scanLegacy,
      reconcileLegacy,
    });
  }

  it('initializes an empty managed library without creating or changing the legacy folder', async () => {
    scanLegacy.mockResolvedValue({ healthy: false, candidates: [], issues: ['missing'] });

    await expect(migration().run()).resolves.toMatchObject({ mode: 'managed' });

    expect(reconcileLegacy).not.toHaveBeenCalled();
    expect(stateCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'primary', mode: 'managed' }),
      { requestKey: null },
    );
  });

  it('reconciles a healthy legacy library once, backfills records, and switches authority', async () => {
    documentCollection.getFullList.mockResolvedValue([document()]);

    await expect(migration().run()).resolves.toMatchObject({ mode: 'managed' });

    expect(reconcileLegacy).toHaveBeenCalledOnce();
    expect(documentCollection.update).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({
        lifecycleState: 'active',
        displayTitle: 'Runbook',
        revision: 1,
        publishedAt: '2026-07-15T12:00:00.000Z',
      }),
      { requestKey: null },
    );
    expect(stateCollection.update).toHaveBeenLastCalledWith(
      'state-1',
      expect.objectContaining({ mode: 'managed' }),
      { requestKey: null },
    );
  });

  it('resumes an interrupted migration but never restarts a managed watcher', async () => {
    stateCollection.getFirstListItem.mockResolvedValue({
      id: 'state-1',
      key: 'primary',
      mode: 'migrating',
      revision: 1,
    });
    documentCollection.getFullList.mockResolvedValue([document()]);

    await migration().run();
    expect(reconcileLegacy).toHaveBeenCalledOnce();

    reconcileLegacy.mockClear();
    stateCollection.getFirstListItem.mockResolvedValue({
      id: 'state-1',
      key: 'primary',
      mode: 'managed',
      revision: 2,
    });
    await migration().run();
    expect(reconcileLegacy).not.toHaveBeenCalled();
  });

  it('preserves existing records and requires recovery when the source is unavailable', async () => {
    documentCollection.getFullList.mockResolvedValue([document()]);
    scanLegacy.mockResolvedValue({ healthy: false, candidates: [], issues: ['unreadable'] });

    await expect(migration().run()).resolves.toMatchObject({ mode: 'recovery-required' });
    expect(reconcileLegacy).not.toHaveBeenCalled();
    expect(documentCollection.update).not.toHaveBeenCalled();
  });

  it('can explicitly adopt preserved records without reading or writing the source folder', async () => {
    stateCollection.getFirstListItem.mockResolvedValue({
      id: 'state-1',
      key: 'primary',
      mode: 'recovery-required',
      revision: 1,
    });
    documentCollection.getFullList.mockResolvedValue([document()]);

    await expect(migration().adoptCurrentLibrary('operator-admin')).resolves.toMatchObject({
      mode: 'managed',
    });
    expect(scanLegacy).not.toHaveBeenCalled();
    expect(reconcileLegacy).not.toHaveBeenCalled();
    expect(documentCollection.update).toHaveBeenCalledOnce();
  });
});
