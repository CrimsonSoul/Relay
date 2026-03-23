import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger', () => ({
  loggers: {
    retention: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

import { RetentionManager } from './RetentionManager';

function makeRecord(id: string) {
  return { id };
}

function makePb(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const defaultCollection = {
    getFullList: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const collectionFn = vi.fn().mockReturnValue({ ...defaultCollection, ...overrides });
  return {
    collection: collectionFn,
  } as unknown as import('pocketbase').default;
}

describe('RetentionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('constructs with a PocketBase client', () => {
      const pb = makePb();
      const manager = new RetentionManager(pb);
      expect(manager).toBeDefined();
    });
  });

  describe('runCleanup()', () => {
    it('calls cleanup for all three collections', async () => {
      const getFullList = vi.fn().mockResolvedValue([]);
      const pb = makePb({ getFullList });
      const manager = new RetentionManager(pb);

      await manager.runCleanup();

      // Each of the three cleaners calls getFullList at least once
      const collections = pb.collection.mock.calls.map((c) => c[0]);
      expect(collections).toContain('bridge_history');
      expect(collections).toContain('alert_history');
      expect(collections).toContain('conflict_log');
    });

    it('logs completion after cleanup', async () => {
      const { loggers } = await import('../logger');
      const pb = makePb();
      const manager = new RetentionManager(pb);

      await manager.runCleanup();

      expect(loggers.retention.info).toHaveBeenCalledWith('Retention cleanup complete');
    });
  });

  describe('startSchedule()', () => {
    it('runs cleanup immediately on start', async () => {
      const getFullList = vi.fn().mockResolvedValue([]);
      const pb = makePb({ getFullList });
      const manager = new RetentionManager(pb);

      manager.startSchedule(60_000);
      // Let the initial async cleanup resolve without triggering the interval loop
      await vi.advanceTimersByTimeAsync(0);
      manager.stop();

      expect(getFullList).toHaveBeenCalled();
    });

    it('runs cleanup again after the interval elapses', async () => {
      const getFullList = vi.fn().mockResolvedValue([]);
      const pb = makePb({ getFullList });
      const manager = new RetentionManager(pb);
      const intervalMs = 60_000;

      manager.startSchedule(intervalMs);
      await vi.advanceTimersByTimeAsync(0);
      const callsAfterStart = getFullList.mock.calls.length;

      await vi.advanceTimersByTimeAsync(intervalMs);

      expect(getFullList.mock.calls.length).toBeGreaterThan(callsAfterStart);

      manager.stop();
    });
  });

  describe('stop()', () => {
    it('clears the interval so cleanup no longer fires', async () => {
      const getFullList = vi.fn().mockResolvedValue([]);
      const pb = makePb({ getFullList });
      const manager = new RetentionManager(pb);
      const intervalMs = 60_000;

      manager.startSchedule(intervalMs);
      await vi.advanceTimersByTimeAsync(0);
      manager.stop();

      const callsAfterStop = getFullList.mock.calls.length;
      await vi.advanceTimersByTimeAsync(intervalMs * 5);

      expect(getFullList.mock.calls.length).toBe(callsAfterStop);
    });

    it('is safe to call when not started', () => {
      const pb = makePb();
      const manager = new RetentionManager(pb);
      expect(() => manager.stop()).not.toThrow();
    });
  });

  describe('cleanBridgeHistory()', () => {
    it('deletes expired bridge_history records (>30 days old)', async () => {
      const expiredRecords = [makeRecord('old-1'), makeRecord('old-2')];
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const getFullList = vi
        .fn()
        .mockResolvedValueOnce(expiredRecords) // expired records
        .mockResolvedValueOnce([]); // all records (cap check)

      const pb = {
        collection: vi.fn().mockReturnValue({ getFullList, delete: deleteMock }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(deleteMock).toHaveBeenCalledWith('old-1');
      expect(deleteMock).toHaveBeenCalledWith('old-2');
    });

    it('prunes bridge_history to 100 most recent records', async () => {
      const allRecords = Array.from({ length: 110 }, (_, i) => makeRecord(`rec-${i}`));
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const getFullList = vi
        .fn()
        .mockResolvedValueOnce([]) // no expired records
        .mockResolvedValueOnce(allRecords); // all 110 records

      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'bridge_history') return { getFullList, delete: deleteMock };
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      // 110 - 100 = 10 excess records deleted
      expect(deleteMock).toHaveBeenCalledTimes(10);
    });

    it('logs error if bridge_history cleanup throws', async () => {
      const { loggers } = await import('../logger');
      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'bridge_history') {
            return {
              getFullList: vi.fn().mockRejectedValue(new Error('DB error')),
              delete: vi.fn(),
            };
          }
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(loggers.retention.error).toHaveBeenCalledWith(
        'Bridge history cleanup failed',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('cleanAlertHistory()', () => {
    it('deletes expired unpinned alert_history records (>90 days old)', async () => {
      const expiredAlerts = [makeRecord('alert-old-1')];
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const getFullList = vi
        .fn()
        .mockResolvedValueOnce(expiredAlerts) // expired
        .mockResolvedValueOnce([]) // unpinned cap check
        .mockResolvedValueOnce([]); // pinned cap check

      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'alert_history') return { getFullList, delete: deleteMock };
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(deleteMock).toHaveBeenCalledWith('alert-old-1');
    });

    it('prunes unpinned alerts to 50 most recent', async () => {
      const unpinnedRecords = Array.from({ length: 60 }, (_, i) => makeRecord(`unpinned-${i}`));
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const getFullList = vi
        .fn()
        .mockResolvedValueOnce([]) // expired
        .mockResolvedValueOnce(unpinnedRecords) // 60 unpinned
        .mockResolvedValueOnce([]); // pinned cap check

      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'alert_history') return { getFullList, delete: deleteMock };
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      // 60 - 50 = 10 excess deleted
      expect(deleteMock).toHaveBeenCalledTimes(10);
    });

    it('prunes pinned alerts to 100 most recent', async () => {
      const pinnedRecords = Array.from({ length: 105 }, (_, i) => makeRecord(`pinned-${i}`));
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const getFullList = vi
        .fn()
        .mockResolvedValueOnce([]) // expired
        .mockResolvedValueOnce([]) // unpinned cap check
        .mockResolvedValueOnce(pinnedRecords); // 105 pinned

      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'alert_history') return { getFullList, delete: deleteMock };
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      // 105 - 100 = 5 excess deleted
      expect(deleteMock).toHaveBeenCalledTimes(5);
    });

    it('logs error if alert_history cleanup throws', async () => {
      const { loggers } = await import('../logger');
      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'alert_history') {
            return { getFullList: vi.fn().mockRejectedValue(new Error('fail')), delete: vi.fn() };
          }
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(loggers.retention.error).toHaveBeenCalledWith(
        'Alert history cleanup failed',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('cleanConflictLog()', () => {
    it('deletes expired conflict_log records (>90 days old)', async () => {
      const expiredConflicts = [makeRecord('conflict-1'), makeRecord('conflict-2')];
      const deleteMock = vi.fn().mockResolvedValue(undefined);

      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'conflict_log') {
            return {
              getFullList: vi.fn().mockResolvedValue(expiredConflicts),
              delete: deleteMock,
            };
          }
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(deleteMock).toHaveBeenCalledWith('conflict-1');
      expect(deleteMock).toHaveBeenCalledWith('conflict-2');
    });

    it('logs error if conflict_log cleanup throws', async () => {
      const { loggers } = await import('../logger');
      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'conflict_log') {
            return { getFullList: vi.fn().mockRejectedValue(new Error('fail')), delete: vi.fn() };
          }
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(loggers.retention.error).toHaveBeenCalledWith(
        'Conflict log cleanup failed',
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe('batchDelete chunk behaviour', () => {
    it('deletes records in parallel chunks of 10', async () => {
      // 25 records → 3 chunks: 10, 10, 5
      const records = Array.from({ length: 25 }, (_, i) => makeRecord(`r-${i}`));
      const deleteMock = vi.fn().mockResolvedValue(undefined);

      const pb = {
        collection: vi.fn().mockImplementation((col: string) => {
          if (col === 'conflict_log') {
            return { getFullList: vi.fn().mockResolvedValue(records), delete: deleteMock };
          }
          return { getFullList: vi.fn().mockResolvedValue([]), delete: vi.fn() };
        }),
      } as unknown as import('pocketbase').default;

      const manager = new RetentionManager(pb);
      await manager.runCleanup();

      expect(deleteMock).toHaveBeenCalledTimes(25);
    });
  });
});
