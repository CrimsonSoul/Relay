import { fireEvent, render, screen } from '@testing-library/react';
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
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(await screen.findByText('relay-noc')).toBeVisible();
  expect(screen.getByText('1.9.8')).toBeVisible();
  expect(screen.queryByRole('button', { name: /restore|install/i })).not.toBeInTheDocument();
});
