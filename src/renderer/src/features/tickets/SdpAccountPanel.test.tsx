import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import type { BridgeAPI } from '@shared/ipc';
import { SdpAccountPanel } from './SdpAccountPanel';

const originalApi = globalThis.api;
afterEach(() => {
  globalThis.api = originalApi;
});
describe('SDP account panel', () => {
  it('never offers desktop credentials or sign-in to Relay Web', () => {
    const invoke = vi.fn();
    globalThis.api = { ...originalApi, runtime: WEB_RUNTIME, sdpAccount: invoke } as BridgeAPI;
    render(<SdpAccountPanel onClose={vi.fn()} />);
    expect(screen.getByText(/Open Relay desktop/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('offers only work sign-in after server setup', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ success: true, data: { configured: true, status: 'disconnected' } });
    globalThis.api = { ...originalApi, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
    render(<SdpAccountPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with work account' }));
    expect(invoke).toHaveBeenLastCalledWith({ action: 'connect' });
    expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
  });
  it('directs an unconfigured connection to server administration', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ success: true, data: { configured: false, status: 'disconnected' } });
    globalThis.api = { ...originalApi, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
    render(<SdpAccountPanel onClose={vi.fn()} />);
    expect(await screen.findByText(/one-time setup/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
  });
  it('keeps the account panel focused on sign-in and disconnect', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        data: {
          configured: true,
          status: 'connected',
          ticket: { number: '810129', status: 'Open', priority: 'Low', group: 'NOC' },
        },
      })
      .mockResolvedValue({ success: true, data: { configured: true, status: 'disconnected' } });
    globalThis.api = { ...originalApi, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
    render(<SdpAccountPanel onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Disconnect' });
    expect(screen.queryByRole('button', { name: /Read ticket/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await screen.findByRole('button', { name: 'Sign in with work account' });
    expect(screen.queryByRole('region', { name: 'Live SDP test ticket' })).not.toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith({ action: 'disconnect' });
  });
});
