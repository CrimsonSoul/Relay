import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstationSettings } from './WorkstationSettings';

describe('WorkstationSettings', () => {
  const getWorkstationAwakeState = vi.fn();
  const setWorkstationAwakeEnabled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getWorkstationAwakeState.mockResolvedValue({
      supported: true,
      enabled: true,
      status: 'active',
    });
    setWorkstationAwakeEnabled.mockResolvedValue({
      success: true,
      data: { supported: true, enabled: false, status: 'disabled' },
    });
    vi.stubGlobal('api', {
      getWorkstationAwakeState,
      setWorkstationAwakeEnabled,
      platform: 'win32',
    });
  });

  it('shows active default-on protection after loading the Windows state', async () => {
    render(<WorkstationSettings />);

    const toggle = await screen.findByRole('switch', {
      name: 'Keep this PC awake while Relay is running',
    });
    expect(toggle).toBeChecked();
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.getByText(/No administrator access is required/i)).toBeVisible();
  });

  it('persists an opt-out and announces the resulting disabled state', async () => {
    render(<WorkstationSettings />);
    const toggle = await screen.findByRole('switch', {
      name: 'Keep this PC awake while Relay is running',
    });

    fireEvent.click(toggle);

    await waitFor(() => expect(setWorkstationAwakeEnabled).toHaveBeenCalledWith(false));
    expect(await screen.findByText('Off')).toBeVisible();
    expect(toggle).not.toBeChecked();
  });

  it('explains a degraded native-input state without claiming full protection', async () => {
    getWorkstationAwakeState.mockResolvedValue({
      supported: true,
      enabled: true,
      status: 'degraded',
      error: 'input-pulse-failed',
    });

    render(<WorkstationSettings />);

    expect(await screen.findByText('Limited')).toBeVisible();
    expect(screen.getByText(/Windows blocked the inactivity pulse/i)).toBeVisible();
  });

  it('distinguishes a state-read failure from an unsupported platform', async () => {
    getWorkstationAwakeState.mockRejectedValue(new Error('IPC unavailable'));

    render(<WorkstationSettings />);

    expect(await screen.findByText('Unavailable')).toBeVisible();
    expect(screen.queryByText('Windows only')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not read this workstation setting/i);
  });

  it('announces a pending preference update while the switch is disabled', async () => {
    let resolveUpdate!: (value: unknown) => void;
    setWorkstationAwakeEnabled.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    render(<WorkstationSettings />);
    const toggle = await screen.findByRole('switch', {
      name: 'Keep this PC awake while Relay is running',
    });

    fireEvent.click(toggle);

    expect(await screen.findByText('Turning off…')).toBeVisible();
    expect(toggle).toBeDisabled();
    resolveUpdate({
      success: true,
      data: { supported: true, enabled: false, status: 'disabled' },
    });
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });
});
