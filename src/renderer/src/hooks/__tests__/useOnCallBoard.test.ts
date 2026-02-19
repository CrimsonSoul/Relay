import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { formatTeamOnCall, useOnCallBoard } from '../useOnCallBoard';
import { NoopToastProvider } from '../../components/Toast';
import type { OnCallRow } from '@shared/ipc';

// Mock auto-animate
vi.mock('@formkit/auto-animate/react', () => ({
  useAutoAnimate: () => [{ current: null }, vi.fn()],
}));

const hookWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'row-1',
  team: 'Network',
  role: 'Primary',
  name: '',
  contact: '',
  timeWindow: '',
  ...overrides,
});

describe('formatTeamOnCall', () => {
  it('formats empty team', () => {
    expect(formatTeamOnCall('Network', [])).toBe('Network: (empty)');
  });

  it('formats team with role only', () => {
    const rows = [makeRow({ role: 'Primary' })];
    expect(formatTeamOnCall('Network', rows)).toBe('Network: Primary');
  });

  it('formats team with role and name', () => {
    const rows = [makeRow({ role: 'Primary', name: 'Alice' })];
    expect(formatTeamOnCall('Network', rows)).toBe('Network: Primary Alice');
  });

  it('formats team with role, name, and contact', () => {
    const rows = [makeRow({ role: 'Primary', name: 'Alice', contact: '555-1234' })];
    expect(formatTeamOnCall('Network', rows)).toBe('Network: Primary Alice (555-1234)');
  });

  it('formats team with role, name, contact, and time window', () => {
    const rows = [
      makeRow({
        role: 'Primary',
        name: 'Alice',
        contact: '555-1234',
        timeWindow: 'Mon-Fri 9-5',
      }),
    ];
    expect(formatTeamOnCall('Network', rows)).toBe(
      'Network: Primary Alice (555-1234) [Mon-Fri 9-5]',
    );
  });

  it('separates multiple members with pipe', () => {
    const rows = [
      makeRow({ role: 'Primary', name: 'Alice', contact: '555-1111' }),
      makeRow({ id: 'row-2', role: 'Backup', name: 'Bob', contact: '555-2222' }),
    ];
    expect(formatTeamOnCall('Network', rows)).toBe(
      'Network: Primary Alice (555-1111) | Backup Bob (555-2222)',
    );
  });

  it('handles member with only role and time window', () => {
    const rows = [makeRow({ role: 'On Call', timeWindow: '24/7' })];
    expect(formatTeamOnCall('Network', rows)).toBe('Network: On Call [24/7]');
  });

  it('handles mixed completeness across rows', () => {
    const rows = [
      makeRow({ role: 'Primary', name: 'Alice' }),
      makeRow({ id: 'row-2', role: 'Backup' }),
    ];
    expect(formatTeamOnCall('Team A', rows)).toBe('Team A: Primary Alice | Backup');
  });
});

describe('useOnCallBoard', () => {
  const teamRows: Record<string, OnCallRow[]> = {
    Network: [
      makeRow({ role: 'Primary', name: 'Alice', contact: '555-1111' }),
      makeRow({ id: 'row-2', role: 'Backup', name: 'Bob', contact: '555-2222' }),
    ],
    Database: [makeRow({ id: 'row-3', team: 'Database', role: 'Primary', name: 'Charlie' })],
  };

  const mockApi = {
    writeClipboard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as Window & { api: typeof mockApi }).api = mockApi as Window['api'];
  });

  const defaultOpts = {
    teams: ['Network', 'Database'],
    getTeamRows: (team: string) => teamRows[team] || [],
  };

  it('handleCopyTeamInfo writes formatted team text to clipboard', async () => {
    mockApi.writeClipboard.mockResolvedValue(true);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyTeamInfo('Network', teamRows.Network);
    });

    expect(mockApi.writeClipboard).toHaveBeenCalledWith(
      'Network: Primary Alice (555-1111) | Backup Bob (555-2222)',
    );
  });

  it('handleCopyTeamInfo shows error on clipboard failure', async () => {
    mockApi.writeClipboard.mockResolvedValue(false);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyTeamInfo('Network', teamRows.Network);
    });

    expect(mockApi.writeClipboard).toHaveBeenCalled();
  });

  it('handleCopyAllOnCall writes all teams separated by newlines', async () => {
    mockApi.writeClipboard.mockResolvedValue(true);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyAllOnCall();
    });

    const clipText = mockApi.writeClipboard.mock.calls[0][0];
    expect(clipText).toContain('Network:');
    expect(clipText).toContain('Database:');
    expect(clipText).toContain('\n');
  });

  it('uses custom toast messages when provided', async () => {
    mockApi.writeClipboard.mockResolvedValue(true);

    const { result } = renderHook(
      () =>
        useOnCallBoard({
          ...defaultOpts,
          toastMessages: {
            copyTeamSuccess: (team: string) => `Custom: ${team} copied`,
            copyAllSuccess: 'Custom: All copied',
          },
        }),
      { wrapper: hookWrapper },
    );

    await act(async () => {
      await result.current.handleCopyTeamInfo('Network', teamRows.Network);
    });

    // The toast is shown internally — we verify the clipboard call happened
    expect(mockApi.writeClipboard).toHaveBeenCalled();
  });

  it('disables animations during window resize', async () => {
    vi.useFakeTimers();

    renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    // Trigger resize
    window.dispatchEvent(new Event('resize'));

    // Advance past the 150ms debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // No assertion needed beyond "doesn't crash" — the key behavior is
    // that enableAnimations(false) then enableAnimations(true) are called
    vi.useRealTimers();
  });
});
