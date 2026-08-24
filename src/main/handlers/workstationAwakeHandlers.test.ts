import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupWorkstationAwakeHandlers } from './workstationAwakeHandlers';

const mocks = vi.hoisted(() => ({
  assertTrustedIpcSender: vi.fn(() => true),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: mocks.assertTrustedIpcSender,
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('setupWorkstationAwakeHandlers', () => {
  const handlers: Record<string, Handler> = {};
  const service = {
    getState: vi.fn(() => ({ supported: true, enabled: true, status: 'active' as const })),
    setEnabled: vi.fn((enabled: boolean) => ({
      supported: true,
      enabled,
      status: enabled ? ('active' as const) : ('disabled' as const),
    })),
  };

  const call = (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler({}, ...args);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(handlers)) delete handlers[key];
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as Handler;
      return ipcMain;
    });
    setupWorkstationAwakeHandlers(() => service);
  });

  it('returns the current protection state to a trusted renderer', () => {
    expect(call(IPC_CHANNELS.WORKSTATION_AWAKE_GET_STATE)).toEqual({
      supported: true,
      enabled: true,
      status: 'active',
    });
  });

  it('accepts only a boolean preference and returns the updated state', () => {
    expect(call(IPC_CHANNELS.WORKSTATION_AWAKE_SET_ENABLED, false)).toEqual({
      success: true,
      data: { supported: true, enabled: false, status: 'disabled' },
    });
    expect(service.setEnabled).toHaveBeenCalledWith(false);

    expect(call(IPC_CHANNELS.WORKSTATION_AWAKE_SET_ENABLED, 'false')).toEqual({
      success: false,
      error: 'Invalid workstation keep-awake preference.',
    });
    expect(service.setEnabled).toHaveBeenCalledOnce();
  });

  it('does not expose or mutate the service for an untrusted renderer', () => {
    mocks.assertTrustedIpcSender.mockReturnValue(false);

    expect(call(IPC_CHANNELS.WORKSTATION_AWAKE_GET_STATE)).toEqual({
      supported: false,
      enabled: false,
      status: 'unsupported',
    });
    expect(call(IPC_CHANNELS.WORKSTATION_AWAKE_SET_ENABLED, true)).toEqual({
      success: false,
      error: 'Workstation keep-awake is unavailable.',
    });
    expect(service.getState).not.toHaveBeenCalled();
    expect(service.setEnabled).not.toHaveBeenCalled();
  });
});
