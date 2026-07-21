/* eslint-disable sonarjs/no-clear-text-protocols */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RelayWebAccessSettings } from './RelayWebAccessSettings';

vi.mock('../TactileButton', () => ({
  TactileButton: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

describe('RelayWebAccessSettings', () => {
  const getWebServerState = vi.fn();
  const saveWebServerConfig = vi.fn();
  const retryWebServer = vi.fn();
  const writeClipboard = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getWebServerState.mockResolvedValue({
      enabled: true,
      status: 'available',
      port: 8091,
      url: 'http://192.168.1.25:8091',
    });
    saveWebServerConfig.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        status: 'available',
        port: 8092,
        url: 'http://192.168.1.25:8092',
      },
    });
    retryWebServer.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        status: 'available',
        port: 8091,
        url: 'http://192.168.1.25:8091',
      },
    });
    Object.assign(globalThis, {
      api: {
        getWebServerState,
        saveWebServerConfig,
        retryWebServer,
        writeClipboard,
      },
    });
  });

  it('shows the enabled listener, exact URL, and permanent transport warning', async () => {
    render(<RelayWebAccessSettings pocketBasePort={8090} />);

    expect(await screen.findByRole('checkbox', { name: 'Enable browser backup' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Browser port' })).toHaveValue(8091);
    expect(screen.getByRole('spinbutton', { name: 'Browser port' })).toHaveClass('tactile-input');
    expect(screen.getByText('Available')).toBeVisible();
    expect(screen.getByText('http://192.168.1.25:8091')).toBeVisible();
    expect(
      screen.getByText('Trusted LAN/VPN only - browser traffic is not encrypted'),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Copy browser URL' }));
    expect(writeClipboard).toHaveBeenCalledWith('http://192.168.1.25:8091');
  });

  it('saves a changed exact port and refreshes the displayed state', async () => {
    render(<RelayWebAccessSettings pocketBasePort={8090} />);
    const port = await screen.findByRole('spinbutton', { name: 'Browser port' });

    fireEvent.change(port, { target: { value: '8092' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save web access' }));

    await waitFor(() =>
      expect(saveWebServerConfig).toHaveBeenCalledWith({ enabled: true, port: 8092 }),
    );
    expect(await screen.findByText('http://192.168.1.25:8092')).toBeVisible();
  });

  it('blocks a port that collides with PocketBase and announces the error', async () => {
    render(<RelayWebAccessSettings pocketBasePort={8090} />);
    const port = await screen.findByRole('spinbutton', { name: 'Browser port' });

    fireEvent.change(port, { target: { value: '8090' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save web access' }));

    expect(
      await screen.findByText('Choose a port different from PocketBase (8090).'),
    ).toHaveAttribute('role', 'alert');
    expect(saveWebServerConfig).not.toHaveBeenCalled();
  });

  it('offers retry when the exact configured port is already occupied', async () => {
    getWebServerState.mockResolvedValueOnce({
      enabled: true,
      status: 'conflict',
      port: 8091,
      error: 'port-conflict',
    });
    render(<RelayWebAccessSettings pocketBasePort={8090} />);

    expect(await screen.findByText('Port 8091 is already in use.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry web access' }));

    await waitFor(() => expect(retryWebServer).toHaveBeenCalledOnce());
    expect(await screen.findByText('Available')).toBeVisible();
  });
});
