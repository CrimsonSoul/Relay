/* eslint-disable sonarjs/no-clear-text-protocols */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

    expect(await screen.findByRole('switch', { name: 'Enable Relay Web' })).toBeChecked();
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

  it('dirty-gates Save Relay Web with a No changes reason', async () => {
    render(<RelayWebAccessSettings pocketBasePort={8090} />);
    const port = await screen.findByRole('spinbutton', { name: 'Browser port' });
    const save = screen.getByRole('button', { name: 'Save Relay Web' });

    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('No changes');

    fireEvent.change(port, { target: { value: '8092' } });
    expect(save).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
  });

  it('saves a changed exact port and refreshes the displayed state', async () => {
    render(<RelayWebAccessSettings pocketBasePort={8090} />);
    const port = await screen.findByRole('spinbutton', { name: 'Browser port' });

    fireEvent.change(port, { target: { value: '8092' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Relay Web' }));

    await waitFor(() =>
      expect(saveWebServerConfig).toHaveBeenCalledWith({ enabled: true, port: 8092 }),
    );
    expect(await screen.findByText('http://192.168.1.25:8092')).toBeVisible();
  });

  it('blocks a port that collides with the Relay data server and announces the error', async () => {
    render(<RelayWebAccessSettings pocketBasePort={8090} />);
    const port = await screen.findByRole('spinbutton', { name: 'Browser port' });

    fireEvent.change(port, { target: { value: '8090' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Relay Web' }));

    expect(
      await screen.findByText('Choose a port different from the Relay data server (8090).'),
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry Relay Web' }));

    await waitFor(() => expect(retryWebServer).toHaveBeenCalledOnce());
    expect(await screen.findByText('Available')).toBeVisible();
  });

  describe('copy feedback', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('confirms a copy visibly and through a live region, then resets', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      writeClipboard.mockResolvedValue(true);
      render(<RelayWebAccessSettings pocketBasePort={8090} />);

      const copy = await screen.findByRole('button', { name: 'Copy browser URL' });
      fireEvent.click(copy);

      await waitFor(() => expect(copy).toHaveTextContent('Copied'));
      expect(screen.getByText('Copied to clipboard')).toHaveAttribute('aria-live', 'polite');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(copy).toHaveTextContent('Copy');
      expect(screen.queryByText('Copied to clipboard')).toBeNull();
    });

    it('reports a failed copy', async () => {
      writeClipboard.mockResolvedValue(false);
      render(<RelayWebAccessSettings pocketBasePort={8090} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Copy browser URL' }));

      expect(await screen.findByRole('button', { name: 'Copy browser URL' })).toHaveTextContent(
        'Copy failed',
      );
    });
  });
});
