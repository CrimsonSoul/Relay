import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import {
  RELAY_RELEASES_URL,
  type RelayReleaseNotes,
  type RelayUpdateCheck,
  type RelayUpdateSnapshot,
} from '@shared/releases';
import { setupReleaseUpdateHandlers } from './releaseUpdateHandlers';

const mocks = vi.hoisted(() => ({
  assertTrustedIpcSender: vi.fn(() => true),
  networkTryConsume: vi.fn(() => ({ allowed: true })),
  fsTryConsume: vi.fn(() => ({ allowed: true })),
  suppressDesktopSideEffects: vi.fn(() => false),
  broadcastToAllWindows: vi.fn(),
  requestAppRelaunch: vi.fn(),
  releaseUpdateManager: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: true,
    relaunch: vi.fn(),
    quit: vi.fn(),
  },
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

vi.mock('../app/relaunch', () => ({
  requestAppRelaunch: mocks.requestAppRelaunch,
}));

vi.mock('../releases/ReleaseUpdateManager', () => ({
  ReleaseUpdateManager: mocks.releaseUpdateManager,
}));

vi.mock('../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcastToAllWindows,
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
  const releaseNotes: RelayReleaseNotes = {
    version: '1.1.0',
    title: 'Relay v1.1.0',
    body: 'Faster update preparation.',
    publishedAt: '2026-08-12T12:44:01Z',
    immutable: true,
  };
  const getCachedReleaseNotes = vi.fn(async () => [releaseNotes]);
  const refreshReleaseNotes = vi.fn(async () => [releaseNotes]);
  const updateSnapshot: RelayUpdateSnapshot = {
    phase: 'available',
    currentVersion: '1.0.0',
    latestVersion: '1.1.0',
    installable: true,
    downloadedBytes: 0,
    totalBytes: 140_000_000,
    failureCode: null,
  };
  const snapshot = vi.fn(() => updateSnapshot);
  const subscribe = vi.fn();
  const noteCheck = vi.fn(async () => updateSnapshot);
  const download = vi.fn(async () => ({ ...updateSnapshot, phase: 'downloaded' as const }));
  const cancelDownload = vi.fn(async () => updateSnapshot);
  const install = vi.fn(async () => ({ ...updateSnapshot, phase: 'ready-to-restart' as const }));
  const restart = vi.fn(async () => true);
  let stateListener: ((value: RelayUpdateSnapshot) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTrustedIpcSender.mockReturnValue(true);
    mocks.networkTryConsume.mockReturnValue({ allowed: true });
    mocks.fsTryConsume.mockReturnValue({ allowed: true });
    mocks.suppressDesktopSideEffects.mockReturnValue(false);
    subscribe.mockImplementation((listener: (value: RelayUpdateSnapshot) => void) => {
      stateListener = listener;
      return vi.fn();
    });
    stateListener = null;
    snapshot.mockReturnValue(updateSnapshot);
    noteCheck.mockResolvedValue(updateSnapshot);
    download.mockResolvedValue({ ...updateSnapshot, phase: 'downloaded' });
    cancelDownload.mockResolvedValue(updateSnapshot);
    install.mockResolvedValue({ ...updateSnapshot, phase: 'ready-to-restart' });
    restart.mockResolvedValue(true);
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
      targetCommitish: '0123456789abcdef0123456789abcdef01234567',
      updateAvailable: true,
      installable: true,
      assetSizeBytes: 140_000_000,
      releaseNotes,
    });
    setupReleaseUpdateHandlers({
      service: { check, getCachedReleaseNotes, refreshReleaseNotes },
      manager: {
        snapshot,
        subscribe,
        noteCheck,
        download,
        cancelDownload,
        install,
        restart,
      },
    });
  });

  const invoke = (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler({ sender: {} }, ...args);
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
        targetCommitish: '0123456789abcdef0123456789abcdef01234567',
        updateAvailable: true,
        installable: true,
        assetSizeBytes: 140_000_000,
        releaseNotes,
      },
    });
    expect(mocks.networkTryConsume).toHaveBeenCalledOnce();
    expect(noteCheck).toHaveBeenCalledWith(expect.objectContaining({ latestVersion: '1.1.0' }));
  });

  it('returns the manager-authoritative install capability to the renderer', async () => {
    noteCheck.mockResolvedValueOnce({
      ...updateSnapshot,
      installable: false,
      failureCode: 'unsupported',
    });

    const result = (await invoke(
      IPC_CHANNELS.APP_CHECK_FOR_UPDATES,
    )) as IpcResult<RelayUpdateCheck>;

    expect(result).toEqual({
      success: true,
      data: {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        targetCommitish: '0123456789abcdef0123456789abcdef01234567',
        updateAvailable: true,
        installable: false,
        assetSizeBytes: 140_000_000,
        releaseNotes,
      },
    });
  });

  it('returns cached release notes immediately and refreshes them through a separate action', async () => {
    await expect(invoke(IPC_CHANNELS.APP_RELEASE_NOTES_GET_CACHED)).resolves.toEqual([
      releaseNotes,
    ]);
    await expect(invoke(IPC_CHANNELS.APP_RELEASE_NOTES_REFRESH)).resolves.toEqual({
      success: true,
      data: [releaseNotes],
    });
    expect(getCachedReleaseNotes).toHaveBeenCalledOnce();
    expect(refreshReleaseNotes).toHaveBeenCalledOnce();
  });

  it('exposes only fixed updater state and manual lifecycle actions', async () => {
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_GET_STATE)).resolves.toEqual(updateSnapshot);
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_DOWNLOAD)).resolves.toEqual({
      success: true,
      data: { ...updateSnapshot, phase: 'downloaded' },
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_CANCEL_DOWNLOAD)).resolves.toEqual({
      success: true,
      data: updateSnapshot,
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_INSTALL)).resolves.toEqual({
      success: true,
      data: { ...updateSnapshot, phase: 'ready-to-restart' },
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_RESTART)).resolves.toEqual({
      success: true,
      data: true,
    });

    expect(download).toHaveBeenCalledOnce();
    expect(cancelDownload).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
  });

  it('routes the production restart handoff through the lifecycle helper', async () => {
    const stableLauncher = 'C:\\Users\\Ryan\\AppData\\Local\\Relay\\Relay.exe';
    mocks.releaseUpdateManager.mockImplementation(function releaseUpdateManager(options: {
      restartApp: (execPath: string) => void;
    }) {
      return {
        snapshot,
        subscribe,
        noteCheck,
        download,
        cancelDownload,
        install,
        restart: async () => {
          options.restartApp(stableLauncher);
          return true;
        },
      };
    });
    const installableService = {
      check,
      getCachedReleaseNotes,
      refreshReleaseNotes,
      resolveLatestInstallable: vi.fn(),
    };
    setupReleaseUpdateHandlers({ service: installableService });

    await expect(invoke(IPC_CHANNELS.APP_UPDATE_RESTART)).resolves.toEqual({
      success: true,
      data: true,
    });

    expect(mocks.requestAppRelaunch).toHaveBeenCalledWith('release-update', {
      execPath: stableLauncher,
    });
  });

  it('broadcasts bounded updater snapshots without renderer-provided paths or URLs', async () => {
    await invoke(IPC_CHANNELS.APP_UPDATE_GET_STATE);
    expect(subscribe).toHaveBeenCalledOnce();
    stateListener?.({ ...updateSnapshot, phase: 'downloading', downloadedBytes: 42 });

    expect(mocks.broadcastToAllWindows).toHaveBeenCalledWith(
      IPC_CHANNELS.APP_UPDATE_STATE_CHANGED,
      { ...updateSnapshot, phase: 'downloading', downloadedBytes: 42 },
    );
  });

  it('fails closed when the renderer is not trusted', async () => {
    mocks.assertTrustedIpcSender.mockReturnValue(false);

    await expect(invoke(IPC_CHANNELS.APP_GET_VERSION)).resolves.toBeNull();
    await expect(invoke(IPC_CHANNELS.APP_CHECK_FOR_UPDATES)).resolves.toEqual({
      success: false,
      error: 'untrusted-sender',
    });
    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(false);
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_GET_STATE)).resolves.toBeNull();
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_DOWNLOAD)).resolves.toEqual({
      success: false,
      error: 'untrusted-sender',
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_CANCEL_DOWNLOAD)).resolves.toEqual({
      success: false,
      error: 'untrusted-sender',
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_INSTALL)).resolves.toEqual({
      success: false,
      error: 'untrusted-sender',
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_RESTART)).resolves.toEqual({
      success: false,
      error: 'untrusted-sender',
    });
    expect(check).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('rate-limits renderer-triggered GitHub checks', async () => {
    mocks.networkTryConsume.mockReturnValue({ allowed: false });

    await expect(invoke(IPC_CHANNELS.APP_CHECK_FOR_UPDATES)).resolves.toEqual({
      success: false,
      error: 'rate-limited',
    });
    expect(check).not.toHaveBeenCalled();

    await expect(invoke(IPC_CHANNELS.APP_UPDATE_DOWNLOAD)).resolves.toEqual({
      success: false,
      error: 'rate-limited',
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('returns a typed rate-limit result for restart requests', async () => {
    mocks.fsTryConsume.mockReturnValue({ allowed: false });

    await expect(invoke(IPC_CHANNELS.APP_UPDATE_RESTART)).resolves.toEqual({
      success: false,
      error: 'rate-limited',
      rateLimited: true,
    });
    expect(restart).not.toHaveBeenCalled();
  });

  it('suppresses updater filesystem and process side effects during isolated Electron tests', async () => {
    mocks.suppressDesktopSideEffects.mockReturnValue(true);

    await expect(invoke(IPC_CHANNELS.APP_UPDATE_DOWNLOAD)).resolves.toEqual({
      success: true,
      data: updateSnapshot,
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_INSTALL)).resolves.toEqual({
      success: true,
      data: updateSnapshot,
    });
    await expect(invoke(IPC_CHANNELS.APP_UPDATE_RESTART)).resolves.toEqual({
      success: true,
      data: true,
    });

    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
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

  it('opens a validated release tag without accepting renderer-controlled URLs', async () => {
    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES, '1.1.0')).resolves.toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith(`${RELAY_RELEASES_URL}/tag/v1.1.0`);

    vi.mocked(shell.openExternal).mockClear();
    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES, '1.1.0/../../malicious')).resolves.toBe(
      false,
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('suppresses opening the browser during isolated Electron tests', async () => {
    mocks.suppressDesktopSideEffects.mockReturnValue(true);

    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(true);
    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES, '1.1.0/../../malicious')).resolves.toBe(
      false,
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('reports a failed release-page launch without throwing into the renderer', async () => {
    vi.mocked(shell.openExternal).mockRejectedValue(new Error('no browser'));

    await expect(invoke(IPC_CHANNELS.APP_OPEN_RELEASES)).resolves.toBe(false);
  });
});
