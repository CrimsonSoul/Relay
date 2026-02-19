import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useGroups } from '../useGroups';
import { NoopToastProvider } from '../../components/Toast';
import type { BridgeGroup } from '@shared/ipc';

// Mock logger
vi.mock('../../utils/logger', () => ({
  loggers: {
    directory: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

describe('useGroups', () => {
  const mockGroups: BridgeGroup[] = [
    { id: 'g1', name: 'Network', contacts: ['a@test.com'], createdAt: 1000, updatedAt: 1000 },
    { id: 'g2', name: 'Database', contacts: ['b@test.com'], createdAt: 2000, updatedAt: 2000 },
  ];

  const mockApi = {
    getGroups: vi.fn(),
    saveGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    importGroupsFromCsv: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as Window & { api: typeof mockApi }).api = mockApi as Window['api'];
    mockApi.getGroups.mockResolvedValue(mockGroups);
  });

  it('loads groups on mount', async () => {
    const { result } = renderHook(() => useGroups(), { wrapper });

    await waitFor(() => {
      expect(result.current.groups).toEqual(mockGroups);
      expect(result.current.loading).toBe(false);
    });
  });

  it('returns empty array when API returns null', async () => {
    mockApi.getGroups.mockResolvedValue(null);

    const { result } = renderHook(() => useGroups(), { wrapper });

    await waitFor(() => {
      expect(result.current.groups).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });

  it('saves a new group and adds it to state', async () => {
    const newGroup: BridgeGroup = {
      id: 'g3',
      name: 'Security',
      contacts: ['c@test.com'],
      createdAt: 3000,
      updatedAt: 3000,
    };
    mockApi.saveGroup.mockResolvedValue({ success: true, data: newGroup });

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saved: BridgeGroup | undefined;
    await act(async () => {
      saved = await result.current.saveGroup({ name: 'Security', contacts: ['c@test.com'] });
    });

    expect(saved).toEqual(newGroup);
    expect(result.current.groups).toHaveLength(3);
    expect(result.current.groups[2]).toEqual(newGroup);
  });

  it('handles save group failure', async () => {
    mockApi.saveGroup.mockResolvedValue(null);

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saved: unknown;
    await act(async () => {
      saved = await result.current.saveGroup({ name: 'Fail', contacts: [] });
    });

    expect(saved).toBeUndefined();
    expect(result.current.groups).toHaveLength(2); // No new group added
  });

  it('updates a group in state', async () => {
    mockApi.updateGroup.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateGroup('g1', { name: 'Network Updated' });
    });

    const updated = result.current.groups.find((g) => g.id === 'g1');
    expect(updated?.name).toBe('Network Updated');
  });

  it('does not update group on API failure', async () => {
    mockApi.updateGroup.mockResolvedValue(false);

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateGroup('g1', { name: 'Network Updated' });
    });

    const group = result.current.groups.find((g) => g.id === 'g1');
    expect(group?.name).toBe('Network');
  });

  it('deletes a group from state', async () => {
    mockApi.deleteGroup.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteGroup('g1');
    });

    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].id).toBe('g2');
  });

  it('does not delete group on API failure', async () => {
    mockApi.deleteGroup.mockResolvedValue(false);

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteGroup('g1');
    });

    expect(result.current.groups).toHaveLength(2);
  });

  it('imports groups from CSV and reloads', async () => {
    mockApi.importGroupsFromCsv.mockResolvedValue({ success: true, count: 5 });
    const updatedGroups = [
      ...mockGroups,
      { id: 'g3', name: 'Imported', contacts: [], createdAt: 0, updatedAt: 0 },
    ];
    mockApi.getGroups.mockResolvedValueOnce(mockGroups).mockResolvedValueOnce(updatedGroups);

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean = false;
    await act(async () => {
      success = await result.current.importFromCsv();
    });

    expect(success).toBe(true);
    expect(mockApi.getGroups).toHaveBeenCalledTimes(2); // Initial load + reload after import
  });

  it('handles CSV import failure', async () => {
    mockApi.importGroupsFromCsv.mockResolvedValue({ success: false, error: 'Bad CSV' });

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean = true;
    await act(async () => {
      success = await result.current.importFromCsv();
    });

    expect(success).toBe(false);
  });

  it('handles exception during loadGroups', async () => {
    mockApi.getGroups.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGroups(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should fall back to empty array and not crash
    expect(result.current.groups).toEqual([]);
  });

  it('handles null result from importGroupsFromCsv', async () => {
    mockApi.importGroupsFromCsv.mockResolvedValue(null);

    const { result } = renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success: boolean = true;
    await act(async () => {
      success = await result.current.importFromCsv();
    });

    expect(success).toBe(false);
  });
});
