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
    getSettings: vi.fn(() => ({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: false,
      selectedAlertingProfiles: [],
    })),
    saveSettings: vi.fn(() => ({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: false,
      selectedAlertingProfiles: [],
    })),
    testSettings: vi.fn(async () => ({ reachable: true, problemCount: 3 })),
    clearSettings: vi.fn(() => true),
    syncNow: vi.fn(async () => 7),
    saveAlertingProfiles: vi.fn(async () => 4),
  };
  const appConfig = {
    load: vi.fn(() => ({ mode: 'server' })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    appConfig.load.mockReturnValue({ mode: 'server' });
    manager.getSettings.mockReturnValue({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: false,
      selectedAlertingProfiles: [],
    });
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

  it('returns only public configuration and never exposes the stored token', () => {
    const result = getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_GET_SETTINGS)({});

    expect(result).toEqual({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: false,
      selectedAlertingProfiles: [],
    });
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('allows a server to preserve its stored token when saving the environment URL', () => {
    const input = { environmentUrl: 'https://abc123.apps.dynatrace.com' };
    const result = getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS)({}, input);

    expect(result).toMatchObject({ success: true });
    expect(manager.saveSettings).toHaveBeenCalledWith(input);
  });

  it('rejects non-Dynatrace and insecure environment URLs before manager access', async () => {
    const insecureUrl = new URL('https://abc123.apps.dynatrace.com');
    insecureUrl.protocol = 'http:';
    for (const environmentUrl of [
      insecureUrl.origin,
      'https://example.com',
      'https://abc123.apps.dynatrace.com/api/v2/problems',
    ]) {
      const result = (await getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_TEST_SETTINGS)(
        {},
        {
          environmentUrl,
        },
      )) as { success: boolean };
      expect(result.success).toBe(false);
    }
    expect(manager.testSettings).not.toHaveBeenCalled();
  });

  it('blocks configuration and sync operations from Relay client mode', async () => {
    appConfig.load.mockReturnValue({ mode: 'client' });

    const save = getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS)(
      {},
      {
        environmentUrl: 'https://abc123.apps.dynatrace.com',
      },
    );
    const sync = await getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)({});
    const profileFilter = await getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER)(
      {},
      ['POS Store'],
    );

    expect(save).toMatchObject({ success: false });
    expect(sync).toMatchObject({ success: false });
    expect(profileFilter).toMatchObject({ success: false });
    expect(manager.saveSettings).not.toHaveBeenCalled();
    expect(manager.saveAlertingProfiles).not.toHaveBeenCalled();
    expect(manager.syncNow).not.toHaveBeenCalled();
  });

  it('wraps a server-side manual sync count in a safe result', async () => {
    await expect(getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)({})).resolves.toEqual({
      success: true,
      data: { count: 7 },
    });
    expect(manager.syncNow).toHaveBeenCalledWith(true);
  });

  it('validates, deduplicates, and saves a server-side profile filter', async () => {
    await expect(
      getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER)({}, [
        'POS Store',
        'Alerts for NOC',
        'POS Store',
      ]),
    ).resolves.toEqual({ success: true, data: { count: 4 } });
    expect(manager.saveAlertingProfiles).toHaveBeenCalledWith(['POS Store', 'Alerts for NOC']);

    await expect(
      getHandler(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER)({}, []),
    ).resolves.toMatchObject({ success: false });
  });
});
