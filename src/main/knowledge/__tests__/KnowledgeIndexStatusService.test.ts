import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeIndexStatusService } from '../KnowledgeIndexStatusService';

describe('KnowledgeIndexStatusService', () => {
  const getFullList = vi.fn();
  const collection = vi.fn(() => ({ getFullList }));
  const pb = { collection };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a stable idle status before PocketBase is available', async () => {
    const service = new KnowledgeIndexStatusService(() => null);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
    expect(collection).not.toHaveBeenCalled();
  });

  it('returns an empty PocketBase-backed status without filesystem state', async () => {
    getFullList.mockResolvedValue([]);
    const service = new KnowledgeIndexStatusService(() => pb as never);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
    expect(getFullList).toHaveBeenCalledWith({
      fields: 'category,indexedAt,lifecycleState',
      requestKey: null,
    });
  });

  it('counts active documents and categories and uses the newest indexed timestamp', async () => {
    getFullList.mockResolvedValue([
      {
        category: 'Operations',
        indexedAt: '2026-07-12T12:00:00.000Z',
        lifecycleState: 'active',
      },
      {
        category: 'Operations',
        indexedAt: '2026-07-14T12:00:00.000Z',
        lifecycleState: 'active',
      },
      {
        category: 'Network',
        indexedAt: '2026-07-13T12:00:00.000Z',
        lifecycleState: 'active',
      },
      {
        category: 'Retired',
        indexedAt: '2026-07-15T12:00:00.000Z',
        lifecycleState: 'trashed',
      },
    ]);
    const service = new KnowledgeIndexStatusService(() => pb as never);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'idle',
      documentCount: 3,
      categoryCount: 2,
      lastIndexedAt: '2026-07-14T12:00:00.000Z',
    });
  });

  it('returns a bounded error status when PocketBase cannot be read', async () => {
    getFullList.mockRejectedValue(new Error('token=secret source=/private/path'));
    const service = new KnowledgeIndexStatusService(() => pb as never);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'error',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
      message: 'Knowledge library status unavailable',
    });
  });
});
