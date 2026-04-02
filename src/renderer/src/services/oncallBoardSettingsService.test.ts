import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetFullList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetOne = vi.fn();

let mockIsOnline = true;

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mockGetFullList,
      create: mockCreate,
      update: mockUpdate,
      getOne: mockGetOne,
    }),
  }),
  handleApiError: vi.fn(),
  isOnline: () => mockIsOnline,
  requireOnline: vi.fn(() => {
    if (!mockIsOnline) throw new Error('You are offline.');
  }),
}));

import {
  initializeBoardSettings,
  getPrimaryBoardSettings,
  updatePrimaryBoardSettings,
  canonicalizeTeamName,
  type BoardSettingsRecord,
} from './oncallBoardSettingsService';
import type { OnCallRecord } from './oncallService';

function makeOncallRow(overrides: Partial<OnCallRecord> = {}): OnCallRecord {
  return {
    id: 'oc1',
    team: 'TeamA',
    teamId: 'team-a',
    role: 'Primary',
    name: 'Alice',
    contact: 'alice@example.com',
    timeWindow: '9-5',
    sortOrder: 0,
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSettingsRecord(overrides: Partial<BoardSettingsRecord> = {}): BoardSettingsRecord {
  return {
    id: 'bs1',
    key: 'primary',
    teamOrder: ['team-a', 'team-b'],
    locked: false,
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsOnline = true;
});

describe('canonicalizeTeamName', () => {
  it('lowercases and trims', () => {
    expect(canonicalizeTeamName('  Team Alpha  ')).toBe('team alpha');
  });

  it('returns empty string for blank input', () => {
    expect(canonicalizeTeamName('')).toBe('');
    expect(canonicalizeTeamName('   ')).toBe('');
  });
});

describe('initializeBoardSettings', () => {
  it('returns ready with correct team order when settings exist', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamA', teamId: 'team-a', sortOrder: 1 }),
      makeOncallRow({ id: 'oc3', team: 'TeamB', teamId: 'team-b', sortOrder: 2 }),
    ];
    const settings = makeSettingsRecord({ teamOrder: ['team-a', 'team-b'] });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('ready');
    expect(result.effectiveTeamOrder).toEqual(['team-a', 'team-b']);
    expect(result.effectiveLocked).toBe(false);
    expect(result.record).toEqual(settings);
  });

  it('bootstraps a new settings record when none exist', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamB', teamId: 'team-b', sortOrder: 1 }),
    ];
    const createdSettings = makeSettingsRecord({ teamOrder: ['team-a', 'team-b'] });
    mockGetFullList.mockResolvedValueOnce([]); // no existing settings
    mockCreate.mockResolvedValueOnce(createdSettings);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('ready');
    expect(mockCreate).toHaveBeenCalledWith({
      key: 'primary',
      teamOrder: ['team-a', 'team-b'],
      locked: false,
    });
    expect(result.effectiveTeamOrder).toEqual(['team-a', 'team-b']);
  });

  it('reconciles stale ids and appends missing ids', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a', sortOrder: 0 }),
      makeOncallRow({ id: 'oc3', team: 'TeamC', teamId: 'team-c', sortOrder: 2 }),
    ];
    // Settings has team-a, team-b (stale), but is missing team-c
    const settings = makeSettingsRecord({ teamOrder: ['team-a', 'team-b'] });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('ready');
    // team-b removed (stale), team-c appended
    expect(result.effectiveTeamOrder).toEqual(['team-a', 'team-c']);
  });

  it('backfills legacy rows missing teamId', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: '', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamB', teamId: '', sortOrder: 1 }),
    ];
    const createdSettings = makeSettingsRecord({
      teamOrder: ['teama', 'teamb'],
    });
    mockGetFullList.mockResolvedValueOnce([]); // no settings
    mockUpdate.mockResolvedValue({}); // backfill updates
    mockCreate.mockResolvedValueOnce(createdSettings);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('ready');
    // Should have called update for each row missing teamId
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith('oc1', { teamId: 'teama' });
    expect(mockUpdate).toHaveBeenCalledWith('oc2', { teamId: 'teamb' });
  });

  it('returns unavailable-offline when offline with no cached record', async () => {
    mockIsOnline = false;
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    mockGetFullList.mockRejectedValueOnce(new Error('network error'));

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('unavailable-offline');
    expect(result.effectiveLocked).toBe(true); // locked-for-safety
  });

  it('returns migrating when backfill partially fails', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: '', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamB', teamId: '', sortOrder: 1 }),
    ];
    mockUpdate
      .mockResolvedValueOnce({}) // oc1 backfill succeeds
      .mockRejectedValueOnce(new Error('write failed')); // oc2 fails

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('migrating');
  });

  it('returns invalid for blank team names', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: '', teamId: '', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamB', teamId: 'team-b', sortOrder: 1 }),
    ];

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns invalid for canonical team name collisions', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'Team A', teamId: '', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'team a', teamId: '', sortOrder: 1 }),
    ];

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('collision'))).toBe(true);
  });

  it('returns invalid for duplicate primary settings records', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    const s1 = makeSettingsRecord({
      id: 'bs1',
      created: '2024-01-01T00:00:00Z',
    });
    const s2 = makeSettingsRecord({
      id: 'bs2',
      created: '2024-01-02T00:00:00Z',
    });
    mockGetFullList.mockResolvedValueOnce([s1, s2]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('returns invalid for malformed teamOrder', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    const settings = makeSettingsRecord({ teamOrder: 'not-an-array' as unknown as string[] });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('teamOrder'))).toBe(true);
  });

  it('handles concurrent bootstrap by refetching on create conflict', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    const existingSettings = makeSettingsRecord({ teamOrder: ['team-a'] });
    mockGetFullList.mockResolvedValueOnce([]); // initially empty
    // Create fails (concurrent race)
    mockCreate.mockRejectedValueOnce(new Error('unique constraint'));
    // Refetch finds the record another client created
    mockGetFullList.mockResolvedValueOnce([existingSettings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('ready');
    expect(result.record).toEqual(existingSettings);
  });
});

describe('getPrimaryBoardSettings', () => {
  it('returns the primary settings record', async () => {
    const settings = makeSettingsRecord();
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await getPrimaryBoardSettings();

    expect(result).toEqual(settings);
  });

  it('returns null when no settings exist', async () => {
    mockGetFullList.mockResolvedValueOnce([]);

    const result = await getPrimaryBoardSettings();

    expect(result).toBeNull();
  });
});

describe('updatePrimaryBoardSettings', () => {
  it('updates only the provided fields', async () => {
    const existing = makeSettingsRecord({ locked: false });
    mockUpdate.mockResolvedValueOnce({ ...existing, locked: true });

    const result = await updatePrimaryBoardSettings('bs1', { locked: true });

    expect(mockUpdate).toHaveBeenCalledWith('bs1', { locked: true });
    expect(result.locked).toBe(true);
  });

  it('preserves untouched fields', async () => {
    const existing = makeSettingsRecord({ teamOrder: ['team-a', 'team-b'], locked: false });
    mockUpdate.mockResolvedValueOnce({ ...existing, locked: true });

    await updatePrimaryBoardSettings('bs1', { locked: true });

    // Only locked was passed to update
    expect(mockUpdate).toHaveBeenCalledWith('bs1', { locked: true });
  });

  it('throws when offline', async () => {
    mockIsOnline = false;

    await expect(updatePrimaryBoardSettings('bs1', { locked: true })).rejects.toThrow(
      'You are offline.',
    );
  });

  it('throws and calls handleApiError when update fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('update failed'));

    await expect(updatePrimaryBoardSettings('bs1', { locked: true })).rejects.toThrow(
      'update failed',
    );
  });
});

describe('getPrimaryBoardSettings — error handling', () => {
  it('throws when getFullList fails', async () => {
    mockGetFullList.mockRejectedValueOnce(new Error('fetch error'));

    await expect(getPrimaryBoardSettings()).rejects.toThrow('fetch error');
  });
});

describe('initializeBoardSettings — validation edge cases', () => {
  it('returns invalid when teamOrder contains non-string entries', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    const settings = makeSettingsRecord({
      teamOrder: ['team-a', 42 as unknown as string],
    });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('non-string'))).toBe(true);
  });

  it('returns invalid when teamOrder contains duplicate entries', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    const settings = makeSettingsRecord({
      teamOrder: ['team-a', 'team-a'],
    });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('returns invalid when locked is not a boolean', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    const settings = makeSettingsRecord({
      locked: 'yes' as unknown as boolean,
    });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('locked'))).toBe(true);
  });

  it('returns invalid when canonical name collides with existing teamId during pre-backfill', async () => {
    // Row with teamId already set to 'teama', and another row without teamId whose canonical is also 'teama'
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'teama', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamA', teamId: '', sortOrder: 1 }),
    ];

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('collision'))).toBe(true);
  });

  it('handles concurrent bootstrap where refetch also returns empty', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    mockGetFullList.mockResolvedValueOnce([]); // initially empty
    mockCreate.mockRejectedValueOnce(new Error('unique constraint')); // create fails
    mockGetFullList.mockResolvedValueOnce([]); // refetch also empty

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('Failed to create or fetch'))).toBe(true);
  });

  it('handles concurrent bootstrap where refetch also fails', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    mockGetFullList.mockResolvedValueOnce([]); // initially empty
    mockCreate.mockRejectedValueOnce(new Error('unique constraint')); // create fails
    mockGetFullList.mockRejectedValueOnce(new Error('refetch failed')); // refetch fails

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('Failed to refetch'))).toBe(true);
  });

  it('skips backfill when no rows need it', async () => {
    const rows = [
      makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a', sortOrder: 0 }),
      makeOncallRow({ id: 'oc2', team: 'TeamB', teamId: 'team-b', sortOrder: 1 }),
    ];
    const settings = makeSettingsRecord({ teamOrder: ['team-a', 'team-b'] });
    mockGetFullList.mockResolvedValueOnce([settings]);

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('ready');
    // No update calls since no backfill needed
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns invalid when backfill encounters blank team names in backfillTeamIds', async () => {
    // Two rows without teamId — one has a blank team name
    // The pre-backfill check catches this first
    const rows = [makeOncallRow({ id: 'oc1', team: '   ', teamId: '', sortOrder: 0 })];

    const result = await initializeBoardSettings(rows);

    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.includes('blank'))).toBe(true);
  });

  it('handles fetch throwing a non-offline error', async () => {
    const rows = [makeOncallRow({ id: 'oc1', team: 'TeamA', teamId: 'team-a' })];
    mockGetFullList.mockRejectedValueOnce(new Error('server error'));

    await expect(initializeBoardSettings(rows)).rejects.toThrow('server error');
  });
});
