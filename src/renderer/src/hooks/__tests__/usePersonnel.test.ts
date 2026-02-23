import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { usePersonnel } from '../usePersonnel';
import { NoopToastProvider } from '../../components/Toast';
import type { OnCallRow } from '@shared/ipc';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRow = (team: string, role: string, name: string): OnCallRow => ({
  id: `${team}-${role}-${name}`,
  team,
  role,
  name,
  contact: `${name.toLowerCase()}@test.com`,
  timeWindow: '',
});

describe('usePersonnel', () => {
  const initialRows: OnCallRow[] = [
    makeRow('Network', 'Primary', 'Alice'),
    makeRow('Network', 'Backup', 'Bob'),
    makeRow('Database', 'Primary', 'Charlie'),
    makeRow('Database', 'Backup', 'Dave'),
  ];

  const mockApi = {
    updateOnCallTeam: vi.fn(),
    removeOnCallTeam: vi.fn(),
    renameOnCallTeam: vi.fn(),
    reorderOnCallTeams: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis.window as unknown as { api: typeof mockApi }).api = mockApi;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('initializes with provided on-call rows', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    expect(result.current.localOnCall).toEqual(initialRows);
    expect(result.current.teams).toEqual(['Network', 'Database']);
  });

  it('syncs with external updates when no mutations pending', () => {
    const { result, rerender } = renderHook(({ rows }) => usePersonnel(rows), {
      wrapper,
      initialProps: { rows: initialRows },
    });

    const updatedRows = [...initialRows, makeRow('Network', 'Tertiary', 'Eve')];
    rerender({ rows: updatedRows });

    expect(result.current.localOnCall).toEqual(updatedRows);
  });

  it('handles updating team rows optimistically', async () => {
    mockApi.updateOnCallTeam.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    const updatedNetworkRows = [
      makeRow('Network', 'Primary', 'Alice'),
      makeRow('Network', 'Backup', 'Eve'),
    ];

    await act(async () => {
      await result.current.handleUpdateRows('Network', updatedNetworkRows);
    });

    const networkRows = result.current.localOnCall.filter((r) => r.team === 'Network');
    expect(networkRows).toHaveLength(2);
    expect(networkRows[1]!.name).toBe('Eve');
  });

  it('preserves team order when updating rows', async () => {
    mockApi.updateOnCallTeam.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    const updatedDatabaseRows = [makeRow('Database', 'Primary', 'Frank')];

    await act(async () => {
      await result.current.handleUpdateRows('Database', updatedDatabaseRows);
    });

    // Network should still come before Database
    const teams = Array.from(new Set(result.current.localOnCall.map((r) => r.team)));
    expect(teams).toEqual(['Network', 'Database']);
  });

  it('handles removing a team', async () => {
    mockApi.removeOnCallTeam.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRemoveTeam('Database');
    });

    expect(result.current.teams).toEqual(['Network']);
    expect(result.current.localOnCall.every((r) => r.team !== 'Database')).toBe(true);
  });

  it('shows error toast on remove team API failure', async () => {
    mockApi.removeOnCallTeam.mockResolvedValue(false);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRemoveTeam('Database');
    });

    // When API returns falsy, the team is NOT removed (if block not entered)
    expect(result.current.teams).toEqual(['Network', 'Database']);
  });

  it('handles renaming a team', async () => {
    mockApi.renameOnCallTeam.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRenameTeam('Database', 'DB Team');
    });

    expect(result.current.teams).toContain('DB Team');
    expect(result.current.teams).not.toContain('Database');
  });

  it('does not rename team on API failure', async () => {
    mockApi.renameOnCallTeam.mockResolvedValue(false);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleRenameTeam('Database', 'DB Team');
    });

    expect(result.current.teams).toContain('Database');
    expect(result.current.teams).not.toContain('DB Team');
  });

  it('handles adding a new team', async () => {
    mockApi.updateOnCallTeam.mockResolvedValue({ success: true });
    mockApi.reorderOnCallTeams.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleAddTeam('Security');
    });

    expect(result.current.teams).toContain('Security');
  });

  it('rolls back add team on API failure', async () => {
    mockApi.updateOnCallTeam.mockResolvedValue(false);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleAddTeam('Security');
    });

    expect(result.current.teams).not.toContain('Security');
  });

  it('handles reordering teams', async () => {
    mockApi.reorderOnCallTeams.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    // Swap Network (index 0) and Database (index 1)
    await act(async () => {
      await result.current.handleReorderTeams(0, 1);
    });

    expect(result.current.teams).toEqual(['Database', 'Network']);
  });

  it('rolls back reorder on API failure', async () => {
    mockApi.reorderOnCallTeams.mockResolvedValue(false);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleReorderTeams(0, 1);
    });

    expect(result.current.teams).toEqual(['Network', 'Database']);
  });

  it('skips reorder when same index', async () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleReorderTeams(0, 0);
    });

    expect(mockApi.reorderOnCallTeams).not.toHaveBeenCalled();
  });

  it('provides a weekRange string with date range and year', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });
    // Format: "Month Day - Month Day, Year" e.g. "February 2 - February 8, 2026"
    expect(result.current.weekRange).toMatch(/^[A-Za-z]+ \d{1,2} - [A-Za-z]+ \d{1,2}, \d{4}$/);
  });

  it('dismisses alerts and persists to localStorage', () => {
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    act(() => {
      result.current.dismissAlert('general');
    });

    const key = result.current.getAlertKey('general');
    expect(result.current.dismissedAlerts.has(key)).toBe(true);
    expect(localStorage.getItem(`dismissed-${key}`)).toBe('true');
  });

  it('handleUpdateRows auto-dismisses general alert on Monday', async () => {
    // Mock Date to be a Monday (day=1)
    vi.setSystemTime(new Date(2026, 1, 2, 10, 0, 0)); // Feb 2, 2026 is a Monday
    mockApi.updateOnCallTeam.mockResolvedValue({ success: true });

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    await act(async () => {
      await result.current.handleUpdateRows('Network', [makeRow('Network', 'Primary', 'Alice')]);
    });

    const key = result.current.getAlertKey('general');
    expect(result.current.dismissedAlerts.has(key)).toBe(true);
  });

  it('handleUpdateRows does not roll back on API failure (only toasts)', async () => {
    mockApi.updateOnCallTeam.mockResolvedValue(false);

    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    const updatedRows = [makeRow('Network', 'Primary', 'Zara')];

    await act(async () => {
      await result.current.handleUpdateRows('Network', updatedRows);
    });

    // Optimistic update should remain (no rollback in the code)
    const networkRows = result.current.localOnCall.filter((r) => r.team === 'Network');
    expect(networkRows).toHaveLength(1);
    expect(networkRows[0]!.name).toBe('Zara');
  });

  it('getAlertKey generates date-based key', () => {
    vi.setSystemTime(new Date(2026, 1, 6, 12, 0, 0)); // Feb 6, 2026
    const { result } = renderHook(() => usePersonnel(initialRows), { wrapper });

    const key = result.current.getAlertKey('general');
    expect(key).toBe('2026-1-6-general');
  });
});
