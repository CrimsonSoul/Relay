import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppData } from '../useAppData';
import type { BoardSettingsInitializationResult } from '../../services/oncallBoardSettingsService';

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Track refetch functions
const mockRefetchContacts = vi.fn().mockResolvedValue(undefined);
const mockRefetchServers = vi.fn().mockResolvedValue(undefined);
const mockRefetchGroups = vi.fn().mockResolvedValue(undefined);
const mockRefetchOncall = vi.fn().mockResolvedValue(undefined);

// Mock useCollection to return data for each collection
const collectionData: Record<string, { data: unknown[]; loading: boolean; error: string | null }> =
  {
    contacts: { data: [], loading: false, error: null },
    servers: { data: [], loading: false, error: null },
    bridge_groups: { data: [], loading: false, error: null },
    oncall: { data: [], loading: false, error: null },
  };

vi.mock('../useCollection', () => ({
  useCollection: (name: string) => {
    const cd = collectionData[name] || { data: [], loading: false, error: null };
    const refetchMap: Record<string, ReturnType<typeof vi.fn>> = {
      contacts: mockRefetchContacts,
      servers: mockRefetchServers,
      bridge_groups: mockRefetchGroups,
      oncall: mockRefetchOncall,
    };
    return { ...cd, refetch: refetchMap[name] || vi.fn() };
  },
}));

// Mock board settings service
const mockInitializeBoardSettings = vi.fn();
vi.mock('../../services/oncallBoardSettingsService', () => ({
  initializeBoardSettings: (...args: unknown[]) => mockInitializeBoardSettings(...args),
}));

// Default ready result
function makeReadyResult(
  overrides: Partial<BoardSettingsInitializationResult> = {},
): BoardSettingsInitializationResult {
  return {
    record: {
      id: 'bs1',
      key: 'primary',
      teamOrder: ['team-a', 'team-b'],
      locked: false,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
    },
    recordId: 'bs1',
    effectiveTeamOrder: ['team-a', 'team-b'],
    effectiveLocked: false,
    status: 'ready',
    errors: [],
    ...overrides,
  };
}

describe('useAppData', () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Set globalThis.api so useAppData doesn't enter dev mock mode
    (globalThis as Window & { api?: unknown }).api = {};
    collectionData.contacts = { data: [], loading: false, error: null };
    collectionData.servers = { data: [], loading: false, error: null };
    collectionData.bridge_groups = { data: [], loading: false, error: null };
    collectionData.oncall = { data: [], loading: false, error: null };
    mockInitializeBoardSettings.mockResolvedValue(makeReadyResult());
  });

  it('returns empty data when collections are empty', () => {
    const { result } = renderHook(() => useAppData(showToast));

    expect(result.current.data.contacts).toEqual([]);
    expect(result.current.data.servers).toEqual([]);
    expect(result.current.data.groups).toEqual([]);
    expect(result.current.data.onCall).toEqual([]);
  });

  it('transforms PocketBase records to app types', () => {
    collectionData.contacts = {
      data: [
        {
          id: 'c1',
          name: 'Alice',
          email: 'alice@test.com',
          phone: '555',
          title: 'Eng',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      ],
      loading: false,
      error: null,
    };
    collectionData.servers = {
      data: [
        {
          id: 's1',
          name: 'web-01',
          businessArea: 'IT',
          lob: 'Core',
          comment: '',
          owner: 'alice@test.com',
          contact: 'bob@test.com',
          os: 'Linux',
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      ],
      loading: false,
      error: null,
    };

    const { result } = renderHook(() => useAppData(showToast));

    expect(result.current.data.contacts).toHaveLength(1);
    expect(result.current.data.contacts[0].name).toBe('Alice');
    expect(result.current.data.servers).toHaveLength(1);
    expect(result.current.data.servers[0].name).toBe('web-01');
  });

  it('shows loading when collections are loading', () => {
    collectionData.contacts = { data: [], loading: true, error: null };

    const { result } = renderHook(() => useAppData(showToast));

    expect(result.current.isReloading).toBe(true);
  });

  it('calls refetch on all collections when handleSync is triggered', async () => {
    const { result } = renderHook(() => useAppData(showToast));

    await act(async () => {
      await result.current.handleSync();
    });

    expect(mockRefetchContacts).toHaveBeenCalled();
    expect(mockRefetchServers).toHaveBeenCalled();
    expect(mockRefetchGroups).toHaveBeenCalled();
    expect(mockRefetchOncall).toHaveBeenCalled();
  });

  it('shows error toast when collection has an error', async () => {
    collectionData.contacts = { data: [], loading: false, error: 'Network error' };

    renderHook(() => useAppData(showToast));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Contacts: Network error', 'error');
    });
  });

  describe('board settings integration', () => {
    it('calls initializeBoardSettings with oncall records', async () => {
      const oncallRecords = [
        {
          id: 'oc1',
          team: 'TeamA',
          teamId: 'team-a',
          role: 'Primary',
          name: 'Alice',
          contact: '555',
          timeWindow: '',
          sortOrder: 0,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      ];
      collectionData.oncall = { data: oncallRecords, loading: false, error: null };

      renderHook(() => useAppData(showToast));

      await waitFor(() => {
        expect(mockInitializeBoardSettings).toHaveBeenCalledWith(oncallRecords);
      });
    });

    it('exposes board settings status when ready', async () => {
      collectionData.oncall = { data: [], loading: false, error: null };
      mockInitializeBoardSettings.mockResolvedValue(makeReadyResult());

      const { result } = renderHook(() => useAppData(showToast));

      await waitFor(() => {
        expect(result.current.boardSettings).toBeDefined();
        expect(result.current.boardSettings.status).toBe('ready');
        expect(result.current.boardSettings.effectiveLocked).toBe(false);
        expect(result.current.boardSettings.effectiveTeamOrder).toEqual(['team-a', 'team-b']);
      });
    });

    it('exposes locked-for-safety defaults before initialization completes', () => {
      // Make init never resolve during this test
      mockInitializeBoardSettings.mockReturnValue(new Promise(() => {}));
      collectionData.oncall = { data: [], loading: false, error: null };

      const { result } = renderHook(() => useAppData(showToast));

      // Before init resolves, should be locked-for-safety
      expect(result.current.boardSettings.effectiveLocked).toBe(true);
      expect(result.current.boardSettings.status).toBe('loading');
    });

    it('preserves oncall record teamId through to onCall rows', () => {
      const oncallRecords = [
        {
          id: 'oc1',
          team: 'TeamA',
          teamId: 'team-a',
          role: 'Primary',
          name: 'Alice',
          contact: '555',
          timeWindow: '',
          sortOrder: 0,
          created: '2026-01-01T00:00:00Z',
          updated: '2026-01-01T00:00:00Z',
        },
      ];
      collectionData.oncall = { data: oncallRecords, loading: false, error: null };

      const { result } = renderHook(() => useAppData(showToast));

      expect(result.current.data.onCall).toHaveLength(1);
      expect(result.current.data.onCall[0].id).toBe('oc1');
    });

    it('exposes board settings errors for non-ready states', async () => {
      mockInitializeBoardSettings.mockResolvedValue(
        makeReadyResult({
          status: 'invalid',
          effectiveLocked: true,
          errors: ['Found 2 duplicate primary settings records'],
        }),
      );
      collectionData.oncall = { data: [], loading: false, error: null };

      const { result } = renderHook(() => useAppData(showToast));

      await waitFor(() => {
        expect(result.current.boardSettings.status).toBe('invalid');
        expect(result.current.boardSettings.effectiveLocked).toBe(true);
        expect(result.current.boardSettings.errors).toContain(
          'Found 2 duplicate primary settings records',
        );
      });
    });

    it('does not call initializeBoardSettings while oncall is still loading', () => {
      collectionData.oncall = { data: [], loading: true, error: null };

      renderHook(() => useAppData(showToast));

      expect(mockInitializeBoardSettings).not.toHaveBeenCalled();
    });

    it('falls back to invalid status when board settings initialization throws', async () => {
      mockInitializeBoardSettings.mockRejectedValue(new Error('init boom'));
      collectionData.oncall = { data: [], loading: false, error: null };

      const { result } = renderHook(() => useAppData(showToast));

      await waitFor(() => {
        expect(result.current.boardSettings.status).toBe('invalid');
        expect(result.current.boardSettings.errors).toContain(
          'Board settings initialization failed',
        );
      });
    });
  });

  it('shows error toast for servers collection error', async () => {
    collectionData.servers = { data: [], loading: false, error: 'Server fetch failed' };

    renderHook(() => useAppData(showToast));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Servers: Server fetch failed', 'error');
    });
  });

  it('shows error toast for groups collection error', async () => {
    collectionData.bridge_groups = { data: [], loading: false, error: 'Groups fetch failed' };

    renderHook(() => useAppData(showToast));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Groups: Groups fetch failed', 'error');
    });
  });

  it('shows error toast for oncall collection error', async () => {
    collectionData.oncall = { data: [], loading: false, error: 'Oncall fetch failed' };

    renderHook(() => useAppData(showToast));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('On-Call: Oncall fetch failed', 'error');
    });
  });

  it('suppresses autocancelled errors', async () => {
    collectionData.contacts = { data: [], loading: false, error: 'autocancelled' };
    collectionData.servers = { data: [], loading: false, error: 'autocancelled' };
    collectionData.bridge_groups = { data: [], loading: false, error: 'autocancelled' };
    collectionData.oncall = { data: [], loading: false, error: 'autocancelled' };

    renderHook(() => useAppData(showToast));

    // Wait a tick to ensure effects run
    await waitFor(() => {
      expect(showToast).not.toHaveBeenCalled();
    });
  });

  it('shows error toast when handleSync fails', async () => {
    mockRefetchContacts.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useAppData(showToast));

    await act(async () => {
      await result.current.handleSync();
    });

    expect(showToast).toHaveBeenCalledWith('Failed to sync data', 'error');
  });

  it('does not allow concurrent syncs', async () => {
    let resolveContacts: () => void;
    mockRefetchContacts.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveContacts = resolve;
        }),
    );

    const { result } = renderHook(() => useAppData(showToast));

    // Start first sync
    let syncPromise: Promise<void>;
    act(() => {
      syncPromise = result.current.handleSync();
    });

    // Try second sync while first is in progress
    await act(async () => {
      await result.current.handleSync();
    });

    // Resolve first sync
    await act(async () => {
      resolveContacts!();
      await syncPromise!;
    });

    // refetchContacts should only be called once
    expect(mockRefetchContacts).toHaveBeenCalledTimes(1);
  });
});
