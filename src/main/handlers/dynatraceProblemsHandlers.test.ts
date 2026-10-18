import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupDynatraceProblemsHandlers } from './dynatraceProblemsHandlers';

const mocks = vi.hoisted(() => ({
  assertTrustedIpcSender: vi.fn(() => true),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: mocks.assertTrustedIpcSender,
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('setupDynatraceProblemsHandlers', () => {
  const handlers: Record<string, Handler> = {};
  const getHandler = (channel: string): Handler => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler;
  };
  const manager = {
    syncNow: vi.fn(async () => 7),
  };
  const appConfig = {
    load: vi.fn(() => ({ mode: 'server' })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedIpcSender.mockReturnValue(true);
    appConfig.load.mockReturnValue({ mode: 'server' });
    for (const key of Object.keys(handlers)) delete handlers[key];
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as Handler;
      return ipcMain;
    });
    setupDynatraceProblemsHandlers(
      () => manager as never,
      () => appConfig as never,
    );
  });

  it('registers only the on-demand sync channel; settings flow through Administration', () => {
    expect(Object.keys(handlers)).toEqual([IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC]);
  });

  it('blocks sync from Relay client mode', async () => {
    appConfig.load.mockReturnValue({ mode: 'client' });

    await expect(getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)({})).resolves.toMatchObject({
      success: false,
    });
    expect(manager.syncNow).not.toHaveBeenCalled();
  });

  it('rejects untrusted senders before touching the manager', async () => {
    mocks.assertTrustedIpcSender.mockReturnValue(false);

    await expect(getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)({})).resolves.toEqual({
      success: false,
      error: 'Untrusted sender',
    });
    expect(manager.syncNow).not.toHaveBeenCalled();
  });

  it('wraps a server-side manual sync count in a safe result', async () => {
    await expect(getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)({})).resolves.toEqual({
      success: true,
      data: { count: 7 },
    });
    expect(manager.syncNow).toHaveBeenCalledWith(true);
  });
});
