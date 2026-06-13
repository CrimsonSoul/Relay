import { ipcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import { setupDynatraceHandlers } from './dynatraceHandlers';

const mocks = vi.hoisted(() => ({
  assertTrustedIpcSender: vi.fn(() => true),
  broadcastToAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: mocks.assertTrustedIpcSender,
}));

vi.mock('../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcastToAllWindows,
}));

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

describe('setupDynatraceHandlers', () => {
  const handlers: Record<string, IpcHandler> = {};
  const dashboard: DynatraceDashboardState = {
    id: 'dt_1',
    name: 'SRE Overview',
    url: 'https://tenant.apps.dynatrace.com/ui/dashboard',
    state: 'closed',
  };
  const input: DynatraceDashboardInput = {
    name: 'SRE Overview',
    url: 'https://tenant.apps.dynatrace.com/ui/dashboard',
  };
  const manager = {
    listDashboards: vi.fn(() => [dashboard]),
    addDashboard: vi.fn(() => dashboard),
    updateDashboard: vi.fn(() => dashboard),
    removeDashboard: vi.fn(() => true),
    openDashboard: vi.fn(async () => true),
    clearSession: vi.fn(async () => true),
    onStateChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedIpcSender.mockReturnValue(true);
    for (const key of Object.keys(handlers)) delete handlers[key];
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as IpcHandler;
      return ipcMain;
    });
    setupDynatraceHandlers(manager as never);
  });

  it('registers dashboard invoke handlers', () => {
    expect(handlers[IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_UPDATE_DASHBOARD]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD]).toBeTypeOf('function');
    expect(handlers[IPC_CHANNELS.DYNATRACE_CLEAR_SESSION]).toBeTypeOf('function');
  });

  it('returns dashboard state from the manager', async () => {
    const result = await handlers[IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS]({});

    expect(result).toEqual([dashboard]);
    expect(manager.listDashboards).toHaveBeenCalled();
  });

  it('wraps dashboard mutations in IpcResult envelopes', async () => {
    const added = (await handlers[IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD](
      {},
      input,
    )) as IpcResult<DynatraceDashboardState>;
    const updated = (await handlers[IPC_CHANNELS.DYNATRACE_UPDATE_DASHBOARD](
      {},
      'dt_1',
      input,
    )) as IpcResult<DynatraceDashboardState>;
    const removed = (await handlers[IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD](
      {},
      'dt_1',
    )) as IpcResult;
    const cleared = (await handlers[IPC_CHANNELS.DYNATRACE_CLEAR_SESSION]({})) as IpcResult;

    expect(added).toEqual({ success: true, data: dashboard });
    expect(updated).toEqual({ success: true, data: dashboard });
    expect(removed).toEqual({ success: true });
    expect(cleared).toEqual({ success: true });
    expect(manager.addDashboard).toHaveBeenCalledWith(input);
    expect(manager.updateDashboard).toHaveBeenCalledWith('dt_1', input);
    expect(manager.removeDashboard).toHaveBeenCalledWith('dt_1');
    expect(manager.clearSession).toHaveBeenCalled();
  });

  it('returns safe defaults for untrusted senders', async () => {
    mocks.assertTrustedIpcSender.mockReturnValue(false);

    await expect(handlers[IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS]({})).resolves.toEqual([]);
    await expect(handlers[IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD]({}, 'dt_1')).resolves.toBe(false);
    await expect(handlers[IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD]({}, input)).resolves.toEqual({
      success: false,
      error: 'Untrusted sender',
    });
  });

  it('broadcasts manager state changes to all windows', () => {
    expect(manager.onStateChange).toHaveBeenCalledWith(expect.any(Function));

    const listener = manager.onStateChange.mock.calls[0][0] as (
      dashboards: DynatraceDashboardState[],
    ) => void;
    listener([dashboard]);

    expect(mocks.broadcastToAllWindows).toHaveBeenCalledWith(
      IPC_CHANNELS.DYNATRACE_DASHBOARDS_CHANGED,
      [dashboard],
    );
  });
});
