import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebAboutSettings } from './WebAboutSettings';
vi.mock('../../hooks/useCollection', () => ({
  useCollection: () => ({ data: [], loading: false, error: null }),
}));
vi.mock('../StatusBar', () => ({ StatusBarLive: () => <span>Connected</span> }));
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.api = undefined;
});
it('reports unavailable status honestly and recovers on an explicit refresh', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        serverName: 'relay-noc',
        version: '1.9.8',
        uptimeSeconds: 3600,
        sessionExpiresAt: Date.now() + 3600000,
      }),
    });
  vi.stubGlobal('fetch', fetcher);
  render(<WebAboutSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read server status');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Status' }));
  expect(await screen.findByText('relay-noc')).toBeVisible();
  expect(screen.getByText('1.9.8')).toBeVisible();
  expect(screen.queryByRole('button', { name: /restore|install/i })).not.toBeInTheDocument();
});
it('keeps a pushed radar snapshot when the slower initial read resolves afterwards', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  let push: ((snapshot: unknown) => void) | undefined;
  let resolveRead!: (snapshot: unknown) => void;
  const read = new Promise((resolve) => {
    resolveRead = resolve;
  });
  globalThis.api = {
    getRadarSnapshot: vi.fn(() => read),
    onRadarSnapshot: vi.fn((listener: (snapshot: unknown) => void) => {
      push = listener;
      return vi.fn();
    }),
  } as never;
  const pushedAt = Date.UTC(2026, 9, 3, 12, 5);
  const staleAt = Date.UTC(2026, 9, 3, 12, 0);
  render(<WebAboutSettings />);
  await screen.findByRole('alert');

  act(() => push?.({ lastUpdated: pushedAt, signInRequired: false }));
  await act(async () => {
    resolveRead({ lastUpdated: staleAt, signInRequired: false });
    await read;
  });

  expect(screen.getByText(new Date(pushedAt).toLocaleString())).toBeVisible();
  expect(screen.queryByText(new Date(staleAt).toLocaleString())).toBeNull();
});
