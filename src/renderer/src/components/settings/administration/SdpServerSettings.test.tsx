import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpServerSettings } from './SdpServerSettings';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
it('keeps setup in server administration and clears the submitted secret after saving', async () => {
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: false,
      revision: '',
      cacheMinutes: 60,
      gatewayEnabled: true,
      gatewayPort: 8091,
    },
  });
  globalThis.api = { ...original, sdpServer: invoke } as BridgeAPI;
  render(<SdpServerSettings />);
  fireEvent.change(await screen.findByLabelText('Client ID'), {
    target: { value: '1000.FIXTURE' },
  });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'dummy-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save server setup' }));
  expect(await screen.findByText(/Server setup saved/)).toBeInTheDocument();
  expect(screen.getByLabelText('Client secret')).toHaveValue('');
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'save',
    expectedRevision: '',
    client: { clientId: '1000.FIXTURE', clientSecret: 'dummy-secret' },
    cacheMinutes: 60,
  });
});
it('does not show configuration inputs when the main process denies access', async () => {
  globalThis.api = {
    ...original,
    sdpServer: vi
      .fn()
      .mockResolvedValue({ success: false, error: 'Server administration required.' }),
  } as BridgeAPI;
  render(<SdpServerSettings />);
  expect(await screen.findByText('Server administration required.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
});
