import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnCallRow } from '@shared/ipc';
const state = vi.hoisted(() => ({
  online: true,
  rows: [] as unknown[],
  reviews: [] as unknown[],
  saved: null as unknown,
  pending: 0,
  reviewError: false,
}));
const create = vi.fn(async (data: unknown) => {
  state.saved = { id: 'review1', ...(data as object), updated: '2026-09-09T00:00:00Z' };
  return state.saved;
});
vi.mock('./pocketbase', () => ({
  isOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error('offline');
  },
  escapeFilter: (s: string) => s,
  getPb: () => ({
    collection: (name: string) => ({
      getFullList: async () => {
        if (name !== 'oncall' && state.reviewError) throw { status: 404 };
        return name === 'oncall' ? state.rows : state.reviews;
      },
      create,
      update: (_id: string, data: unknown) => create(data),
      getOne: async () => state.saved,
    }),
  }),
}));
import { confirmCoverage, coverageFingerprint, coverageState } from './oncallCoverageService';
const row: OnCallRow = {
  id: 'r1',
  team: 'SQL',
  teamId: 'sql',
  role: 'Primary',
  name: 'Alice',
  contact: 'a@b.test',
};
beforeEach(() => {
  vi.clearAllMocks();
  state.online = true;
  state.rows = [row];
  state.reviews = [];
  state.pending = 0;
  state.reviewError = false;
  vi.stubGlobal('api', {
    runtime: { kind: 'desktop' },
    getPendingSyncStatus: async () => ({ pendingCount: state.pending }),
  });
});
describe('coverage confirmation', () => {
  it('persists the chosen calendar date and remains valid after readback', async () => {
    const review = await confirmCoverage({ teamId: 'sql', validThrough: '2099-12-31' }, [row]);
    expect(review.validThrough).toBe('2099-12-31');
    expect(coverageState(review, [{ ...row, updatedAt: Date.now() }])).toBe('confirmed');
    expect(coverageState(review, [{ ...row, name: 'Bob' }])).toBe('needs-review');
    expect(coverageState(review, [])).toBe('needs-review');
    expect(coverageState(review, [row, { ...row, id: 'r2' }])).toBe('needs-review');
  });
  it('rejects stale content from another operator before creating a review', async () => {
    state.rows = [{ ...row, name: 'Bob' }];
    await expect(
      confirmCoverage({ teamId: 'sql', validThrough: '2099-12-31' }, [row]),
    ).rejects.toThrow(/changed/);
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses queued writes, including deletes not visible in current rows', async () => {
    state.pending = 1;
    await expect(
      confirmCoverage({ teamId: 'sql', validThrough: '2099-12-31' }, [row]),
    ).rejects.toThrow(/Sync pending/);
    expect(create).not.toHaveBeenCalled();
  });
  it('rechecks pending work immediately before saving', async () => {
    let reads = 0;
    vi.stubGlobal('api', {
      getPendingSyncStatus: async () => ({ pendingCount: ++reads === 1 ? 0 : 1 }),
    });
    await expect(
      confirmCoverage({ teamId: 'sql', validThrough: '2099-12-31' }, [row]),
    ).rejects.toThrow('Sync pending');
    expect(create).not.toHaveBeenCalled();
  });
  it('explains an older server missing the coverage collection', async () => {
    state.reviewError = true;
    await expect(
      confirmCoverage({ teamId: 'sql', validThrough: '2099-12-31' }, [row]),
    ).rejects.toThrow('Upgrade the Relay server');
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks web offline confirmation', async () => {
    state.online = false;
    vi.stubGlobal('api', { runtime: { kind: 'web' } });
    await expect(
      confirmCoverage({ teamId: 'sql', validThrough: '2099-12-31' }, [row]),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it.each(['2099-02-30', '<script>', '2000-01-01'])(
    'rejects invalid or expired date %s',
    async (validThrough) => {
      await expect(confirmCoverage({ teamId: 'sql', validThrough }, [row])).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('rejects unknown fields and caller supplied fingerprints', async () => {
    await expect(
      confirmCoverage(
        { teamId: 'sql', validThrough: '2099-12-31', rowsFingerprint: 'fake' } as never,
        [row],
      ),
    ).rejects.toThrow();
  });
  it('fingerprints ordered coverage content, not bookkeeping times', () => {
    expect(coverageFingerprint([row])).toBe(
      coverageFingerprint([{ ...row, updatedAt: 500, queuedAt: 'today' }]),
    );
    expect(coverageState(undefined, [row])).toBe('not-confirmed');
  });
});
