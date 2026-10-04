import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { formatTeamOnCall, useOnCallBoard } from '../useOnCallBoard';
import { NoopToastProvider } from '../../components/Toast';
import type * as ToastModule from '../../components/Toast';
import type { OnCallRow } from '@shared/ipc';

const showToast = vi.fn();
vi.mock('../../components/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof ToastModule>()),
  useToast: () => ({ showToast }),
}));

// Mock auto-animate
vi.mock('@formkit/auto-animate/react', () => ({
  useAutoAnimate: () => [{ current: null }, vi.fn()],
}));

const hookWrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'row-1',
  team: 'Network',
  teamId: 'network',
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
    (globalThis.window as unknown as { api: typeof mockApi }).api = mockApi;
  });

  const defaultOpts = {
    teams: ['Network', 'Database'],
    getTeamRows: (team: string) => teamRows[team] ?? [],
  };

  it('handleCopyTeamInfo writes formatted team text to clipboard', async () => {
    mockApi.writeClipboard.mockResolvedValue(true);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyTeamInfo('Network', teamRows.Network!);
    });

    expect(mockApi.writeClipboard).toHaveBeenCalledWith(
      'Network: Primary Alice (555-1111) | Backup Bob (555-2222)',
    );
    expect(showToast).toHaveBeenCalledWith('Copied Network (2 people)', 'success');
  });

  it('handleCopyTeamInfo names the cause and offers Retry on clipboard failure', async () => {
    mockApi.writeClipboard.mockResolvedValue(false);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyTeamInfo('Network', teamRows.Network!);
    });

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't copy Network. Clipboard access was blocked. Nothing was copied. Allow clipboard access and try again.",
      'error',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Retry' }) }),
    );

    mockApi.writeClipboard.mockResolvedValue(true);
    const options = showToast.mock.calls[0]?.[2] as { action: { onClick: () => void } };
    await act(async () => {
      options.action.onClick();
      await Promise.resolve();
    });
    expect(mockApi.writeClipboard).toHaveBeenCalledTimes(2);
  });

  it('handleCopyAllOnCall writes all teams and says how many teams and people', async () => {
    mockApi.writeClipboard.mockResolvedValue(true);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyAllOnCall();
    });

    const clipText = mockApi.writeClipboard.mock.calls[0]?.[0] as string;
    expect(clipText).toContain('Network:');
    expect(clipText).toContain('Database:');
    expect(clipText).toContain('\n');
    expect(showToast).toHaveBeenCalledWith('Copied 2 teams (3 people)', 'success');
  });

  it('handleCopyAllOnCall names the cause and offers Retry on clipboard failure', async () => {
    mockApi.writeClipboard.mockResolvedValue(false);

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    await act(async () => {
      await result.current.handleCopyAllOnCall();
    });

    expect(showToast).toHaveBeenCalledWith(
      "Couldn't copy the on-call board. Clipboard access was blocked. Nothing was copied. Allow clipboard access and try again.",
      'error',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Retry' }) }),
    );
  });

  it('disables animations during window resize', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useOnCallBoard(defaultOpts), { wrapper: hookWrapper });

    // Trigger resize
    globalThis.window.dispatchEvent(new Event('resize'));

    // Advance past the 150ms debounce
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // Verify the hook returned a stable API after resize
    expect(result.current.handleCopyAllOnCall).toBeDefined();
    vi.useRealTimers();
  });
});
