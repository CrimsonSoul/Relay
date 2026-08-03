import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { SettingsModal } from '../SettingsModal';

vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: () => ({
    session: { state: 'signed-out', role: null },
  }),
}));

const CONNECTION_SECRET = 'fixture-passphrase-123';

function createBridgeMock() {
  return {
    runtime: ELECTRON_RUNTIME,
    getConfig: vi.fn().mockResolvedValue({
      mode: 'client' as const,
      serverUrl: 'https://relay.example.test',
      allowInsecureHttp: false,
    }),
    getConnectionSecret: vi.fn().mockResolvedValue(CONNECTION_SECRET),
    clearConfig: vi.fn().mockResolvedValue(true),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
  } satisfies Partial<BridgeAPI>;
}

describe('SettingsModal presence lifecycle', () => {
  let mockApi: ReturnType<typeof createBridgeMock>;

  beforeEach(() => {
    localStorage.clear();
    mockApi = createBridgeMock();
    vi.stubGlobal('api', mockApi);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.classList.remove('modal-open');
  });

  it('preserves an unsaved custom accent draft across a normal close and reopen', async () => {
    const { rerender } = render(<SettingsModal isOpen onClose={vi.fn()} />);
    const accentInput = await screen.findByLabelText('Custom accent hex code');
    fireEvent.change(accentInput, { target: { value: '#123456' } });

    rerender(<SettingsModal isOpen={false} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(<SettingsModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByLabelText('Custom accent hex code')).toHaveValue('#123456');
    expect(mockApi.getConfig).toHaveBeenCalledTimes(2);
    expect(mockApi.getConnectionSecret).toHaveBeenCalledTimes(2);
  });

  it('hides a revealed passphrase when Settings rapidly closes and reopens', async () => {
    const { rerender } = render(<SettingsModal isOpen onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show passphrase' }));
    expect(screen.getByText(`Passphrase: ${CONNECTION_SECRET}`)).toBeVisible();

    rerender(<SettingsModal isOpen={false} onClose={vi.fn()} />);
    expect(document.querySelector('dialog')).toHaveAttribute('data-state', 'closing');
    rerender(<SettingsModal isOpen onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show passphrase' })).toBeVisible(),
    );
    expect(screen.queryByText(`Passphrase: ${CONNECTION_SECRET}`)).not.toBeInTheDocument();
    expect(mockApi.getConfig).toHaveBeenCalledTimes(2);
    expect(mockApi.getConnectionSecret).toHaveBeenCalledTimes(2);
  });
});
