import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { ReleaseUpdateNotificationManager } from '../ReleaseUpdateNotificationManager';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const LAST_NOTIFIED_VERSION_KEY = 'relay:lastNotifiedReleaseVersion';
const CHECK_INTERVAL_MS = 15 * 60 * 1_000;

describe('ReleaseUpdateNotificationManager', () => {
  const checkForUpdates = vi.fn();
  const getUpdateState = vi.fn();
  const downloadUpdate = vi.fn();
  const cancelUpdateDownload = vi.fn();
  const installUpdate = vi.fn();
  const restartToUpdate = vi.fn();
  const onUpdateStateChanged = vi.fn();
  const openReleasesPage = vi.fn().mockResolvedValue(true);
  let stateListener: ((snapshot: unknown) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    stateListener = null;
    getUpdateState.mockResolvedValue(null);
    downloadUpdate.mockResolvedValue({ success: false, error: 'not-started' });
    cancelUpdateDownload.mockResolvedValue({
      success: true,
      data: {
        phase: 'available',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        installable: true,
        downloadedBytes: 0,
        totalBytes: 140_000_000,
        failureCode: null,
      },
    });
    installUpdate.mockResolvedValue({ success: false, error: 'not-started' });
    restartToUpdate.mockResolvedValue({ success: true, data: true });
    onUpdateStateChanged.mockImplementation((listener: (snapshot: unknown) => void) => {
      stateListener = listener;
      return vi.fn();
    });
    checkForUpdates.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
        installable: true,
        assetSizeBytes: 140_000_000,
      },
    });
    vi.stubGlobal('api', {
      runtime: ELECTRON_RUNTIME,
      checkForUpdates,
      getUpdateState,
      downloadUpdate,
      cancelUpdateDownload,
      installUpdate,
      restartToUpdate,
      onUpdateStateChanged,
      openReleasesPage,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows one actionable notification for a newer desktop release', async () => {
    render(<ReleaseUpdateNotificationManager />);

    const reminder = await screen.findByRole('button', {
      name: 'Relay v1.1.0 is available. Review update',
    });
    expect(reminder).toHaveTextContent('Update · v1.1.0');
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledOnce());
    expect(mocks.showToast).toHaveBeenCalledWith('Relay v1.1.0 is available.', 'info', {
      title: 'Update available',
      durationMs: 12_000,
      action: {
        label: 'Review update',
        onClick: expect.any(Function),
      },
    });
    expect(localStorage.getItem(LAST_NOTIFIED_VERSION_KEY)).toBe('1.1.0');

    const options = mocks.showToast.mock.calls[0]?.[2];
    await act(async () => options.action.onClick());
    expect(screen.getByRole('dialog', { name: 'Update Relay' })).toBeVisible();
    expect(openReleasesPage).not.toHaveBeenCalled();
  });

  it('preserves an authoritative unsupported state when its advisory check resolves later', async () => {
    const deferredCheck: {
      resolve?: (value: {
        success: true;
        data: {
          currentVersion: string;
          latestVersion: string;
          updateAvailable: true;
          installable: false;
          assetSizeBytes: number;
        };
      }) => void;
    } = {};
    checkForUpdates.mockReturnValueOnce(
      new Promise((resolvePromise) => {
        deferredCheck.resolve = resolvePromise;
      }),
    );
    render(<ReleaseUpdateNotificationManager />);
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());

    act(() => {
      stateListener?.({
        phase: 'available',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        installable: false,
        downloadedBytes: 0,
        totalBytes: 140_000_000,
        failureCode: 'unsupported',
      });
    });
    await act(async () => {
      deferredCheck.resolve?.({
        success: true,
        data: {
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateAvailable: true,
          installable: false,
          assetSizeBytes: 140_000_000,
        },
      });
      await Promise.resolve();
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Relay v1.1.0 is available. Review update',
      }),
    );
    expect(screen.getByText(/only in packaged Relay for Windows x64/u)).toBeVisible();
    expect(
      screen.queryByText(/cannot install it because GitHub has not locked it as immutable/u),
    ).toBeNull();
  });

  it('does not repeat a release notification already shown on this workstation', async () => {
    localStorage.setItem(LAST_NOTIFIED_VERSION_KEY, '1.1.0');

    render(<ReleaseUpdateNotificationManager />);

    const reminder = await screen.findByRole('button', {
      name: 'Relay v1.1.0 is available. Review update',
    });
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(reminder).toBeVisible();
  });

  it('requires separate download, install, and restart clicks in the renderer flow', async () => {
    downloadUpdate.mockResolvedValueOnce({
      success: true,
      data: {
        phase: 'downloaded',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        installable: true,
        downloadedBytes: 140_000_000,
        totalBytes: 140_000_000,
        failureCode: null,
      },
    });
    installUpdate.mockResolvedValueOnce({
      success: true,
      data: {
        phase: 'ready-to-restart',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        installable: true,
        downloadedBytes: 140_000_000,
        totalBytes: 140_000_000,
        failureCode: null,
      },
    });
    render(<ReleaseUpdateNotificationManager />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Relay v1.1.0 is available. Review update',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledOnce());
    expect(installUpdate).not.toHaveBeenCalled();
    expect(restartToUpdate).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Install update' }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
    expect(restartToUpdate).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Restart Relay' }));
    await waitFor(() => expect(restartToUpdate).toHaveBeenCalledOnce());
  });

  it('allows an in-flight download to be cancelled while its action promise is pending', async () => {
    const deferredDownload: {
      resolve?: (value: Awaited<ReturnType<typeof downloadUpdate>>) => void;
    } = {};
    downloadUpdate.mockReturnValueOnce(
      new Promise((resolvePromise) => {
        deferredDownload.resolve = resolvePromise;
      }),
    );
    render(<ReleaseUpdateNotificationManager />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Relay v1.1.0 is available. Review update',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledOnce());

    act(() => {
      stateListener?.({
        phase: 'downloading',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        installable: true,
        downloadedBytes: 32_000_000,
        totalBytes: 140_000_000,
        failureCode: null,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));

    await waitFor(() => expect(cancelUpdateDownload).toHaveBeenCalledOnce());
    await act(async () => {
      deferredDownload.resolve?.({
        success: true,
        data: {
          phase: 'available',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          installable: true,
          downloadedBytes: 0,
          totalBytes: 140_000_000,
          failureCode: null,
        },
      });
      await Promise.resolve();
    });
  });

  it('keeps restart-ready state noticeable after the update dialog closes', async () => {
    render(<ReleaseUpdateNotificationManager />);
    await screen.findByRole('button', {
      name: 'Relay v1.1.0 is available. Review update',
    });

    act(() => {
      stateListener?.({
        phase: 'ready-to-restart',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        installable: true,
        downloadedBytes: 140_000_000,
        totalBytes: 140_000_000,
        failureCode: null,
      });
    });

    expect(
      screen.getByRole('button', {
        name: 'Relay v1.1.0 is ready to restart. Review update',
      }),
    ).toHaveTextContent('Restart · v1.1.0');
  });

  it('does not notify when the installed release is current', async () => {
    checkForUpdates.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '1.1.0',
        latestVersion: '1.1.0',
        updateAvailable: false,
      },
    });

    render(<ReleaseUpdateNotificationManager />);

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. Review update/u })).toBeNull();
  });

  it('keeps GitHub failures silent in the renderer', async () => {
    checkForUpdates.mockResolvedValue({ success: false, error: 'unavailable' });

    render(<ReleaseUpdateNotificationManager />);

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. Review update/u })).toBeNull();
  });

  it('fails closed when a successful update response has no data', async () => {
    checkForUpdates.mockResolvedValue({ success: true });

    render(<ReleaseUpdateNotificationManager />);

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. Review update/u })).toBeNull();
  });

  it('does not run desktop update checks in Relay Web', async () => {
    vi.stubGlobal('api', {
      runtime: WEB_RUNTIME,
      checkForUpdates,
      openReleasesPage,
    });

    render(<ReleaseUpdateNotificationManager />);
    await act(async () => undefined);

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. Review update/u })).toBeNull();
  });

  it('fails closed when a partial bridge does not identify its runtime', async () => {
    vi.stubGlobal('api', {
      checkForUpdates,
      openReleasesPage,
    });

    render(<ReleaseUpdateNotificationManager />);
    await act(async () => undefined);

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. Review update/u })).toBeNull();
  });

  it('keeps the last confirmed reminder through a failed refresh', async () => {
    vi.useFakeTimers();
    checkForUpdates
      .mockResolvedValueOnce({
        success: true,
        data: {
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateAvailable: true,
        },
      })
      .mockResolvedValueOnce({ success: false, error: 'unavailable' });

    render(<ReleaseUpdateNotificationManager />);
    await act(async () => undefined);
    expect(
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. Review update' }),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. Review update' }),
    ).toBeVisible();
  });

  it('removes the reminder after a successful check reports the installed release current', async () => {
    vi.useFakeTimers();
    checkForUpdates
      .mockResolvedValueOnce({
        success: true,
        data: {
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateAvailable: true,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          currentVersion: '1.1.0',
          latestVersion: '1.1.0',
          updateAvailable: false,
        },
      });

    render(<ReleaseUpdateNotificationManager />);
    await act(async () => undefined);
    expect(
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. Review update' }),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /is available\. Review update/u })).toBeNull();
  });

  it('keeps the reminder visible and shows an error when the release page cannot open', async () => {
    openReleasesPage.mockResolvedValueOnce(false);
    render(<ReleaseUpdateNotificationManager />);

    const reminder = await screen.findByRole('button', {
      name: 'Relay v1.1.0 is available. Review update',
    });
    fireEvent.click(reminder);
    fireEvent.click(await screen.findByRole('button', { name: 'View on GitHub' }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenLastCalledWith(
        'Could not open GitHub Releases. Check your connection and try again.',
        'error',
        { title: 'Release page unavailable' },
      ),
    );
    expect(reminder).toBeVisible();
  });

  it('checks every 15 minutes and notifies for each newly discovered version', async () => {
    vi.useFakeTimers();
    checkForUpdates
      .mockResolvedValueOnce({
        success: true,
        data: {
          currentVersion: '1.0.0',
          latestVersion: '1.0.0',
          updateAvailable: false,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          updateAvailable: true,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          currentVersion: '1.0.0',
          latestVersion: '1.2.0',
          updateAvailable: true,
        },
      });

    render(<ReleaseUpdateNotificationManager />);
    await act(async () => undefined);
    expect(checkForUpdates).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS - 1);
      await Promise.resolve();
    });
    expect(checkForUpdates).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      'Relay v1.1.0 is available.',
      'info',
      expect.any(Object),
    );
    expect(
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. Review update' }),
    ).toHaveTextContent('Update · v1.1.0');

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(checkForUpdates).toHaveBeenCalledTimes(3);
    expect(mocks.showToast).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenLastCalledWith(
      'Relay v1.2.0 is available.',
      'info',
      expect.any(Object),
    );
    expect(
      screen.getByRole('button', { name: 'Relay v1.2.0 is available. Review update' }),
    ).toHaveTextContent('Update · v1.2.0');
    expect(localStorage.getItem(LAST_NOTIFIED_VERSION_KEY)).toBe('1.2.0');
  });
});
