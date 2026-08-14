import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import { RELAY_RELEASES_URL, type RelayUpdateCheck } from '@shared/releases';
import { setupReleaseUpdateHandlers } from './releaseUpdateHandlers';

const mocks = vi.hoisted(() => ({
  assertTrustedIpcSender: vi.fn(() => true),
  networkTryConsume: vi.fn(() => ({ allowed: true })),
  fsTryConsume: vi.fn(() => ({ allowed: true })),
  suppressDesktopSideEffects: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '1.0.0') },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: mocks.assertTrustedIpcSender,
}));

vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    network: { tryConsume: mocks.networkTryConsume },
    fsOperations: { tryConsume: mocks.fsTryConsume },
  },
}));

vi.mock('../app/e2eSafety', () => ({
  shouldSuppressDesktopSideEffects: mocks.suppressDesktopSideEffects,
}));

vi.mock('../logger', () => ({
  loggers: {
    main: { warn: vi.fn() },
    security: { error: vi.fn() },
  },
}));

describe('release update handlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const check = vi.fn<() => Promise<RelayUpdateCheck>>();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedIpcSender.mockReturnValue(true);
    mocks.networkTryConsume.mockReturnValue({ allowed: true });
    mocks.fsTryConsume.mockReturnValue({ allowed: true });
    mocks.suppressDesktopSideEffects.mockReturnValue(false);
    vi.mocked(app.getVersion).mockReturnValue('1.0.0');
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    for (const channel of Object.keys(handlers)) delete handlers[channel];
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    check.mockResolvedValue({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
    });
    setupReleaseUpdateHandlers({ service: { check } });
  });

  const invoke = (channel: string) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler({ sender: {} });
  };

  it('returns Electron package metadata as the installed version', async () => {
    await expect(invoke(IPC_CHANNELS.APP_GET_VERSION)).resolves.toBe('1.0.0');
    expect(app.getVersion).toHaveBeenCalledOnce();
  });

  it('returns the bounded release service result to a trusted renderer', async () => {
    const result = (await invoke(
      IPC_CHANNELS.APP_CHECK_FOR_UPDATES,
    )) as IpcResult<RelayUpdateCheck>;

    expect(result).toEqual({
      success: true,
      data: {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
      },
    });
    expect(mocks.networkTryConsume).toHaveBeenCalledOnce();
  });

  it('fails closed when the renderer is not trusted', async () => {
    mocks.assertTrustedIpcSender.mockReturnValue(false);

    await expect(invoke(IPC_CHANNELS.APP_GET_VERSION)).resolves.toBeNull();
    await expect(invoke(IPC_CHANNELS.APP_CHECK_FOR_UPDATES)).resolves.toEqual({
      success: false,
      error: 'untrusted-sender',
    });
    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(false);
    expect(check).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('rate-limits renderer-triggered GitHub checks', async () => {
    mocks.networkTryConsume.mockReturnValue({ allowed: false });

    await expect(invoke(IPC_CHANNELS.APP_CHECK_FOR_UPDATES)).resolves.toEqual({
      success: false,
      error: 'rate-limited',
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('contains release-check failures behind a generic result', async () => {
    check.mockRejectedValue(new Error('upstream secret detail'));

    await expect(invoke(IPC_CHANNELS.APP_CHECK_FOR_UPDATES)).resolves.toEqual({
      success: false,
      error: 'unavailable',
    });
  });

  it('opens only Relay’s fixed GitHub releases page', async () => {
    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(true);

    expect(shell.openExternal).toHaveBeenCalledWith(RELAY_RELEASES_URL);
    expect(mocks.fsTryConsume).toHaveBeenCalledOnce();
  });

  it('suppresses opening the browser during isolated Electron tests', async () => {
    mocks.suppressDesktopSideEffects.mockReturnValue(true);

    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(true);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('reports a failed release-page launch without throwing into the renderer', async () => {
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('no browser'));

    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(false);
  });
});
