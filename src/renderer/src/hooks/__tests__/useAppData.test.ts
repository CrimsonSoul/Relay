import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppData } from '../useAppData';

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
});
