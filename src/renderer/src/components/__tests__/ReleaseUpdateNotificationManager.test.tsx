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
  const openReleasesPage = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    checkForUpdates.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
      },
    });
    vi.stubGlobal('api', {
      runtime: ELECTRON_RUNTIME,
      checkForUpdates,
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
      name: 'Relay v1.1.0 is available. View release',
    });
    expect(reminder).toHaveTextContent('Update · v1.1.0');
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledOnce());
    expect(mocks.showToast).toHaveBeenCalledWith('Relay v1.1.0 is available.', 'info', {
      title: 'Update available',
      durationMs: 12_000,
      action: {
        label: 'View release',
        onClick: expect.any(Function),
      },
    });
    expect(localStorage.getItem(LAST_NOTIFIED_VERSION_KEY)).toBe('1.1.0');

    const options = mocks.showToast.mock.calls[0]?.[2];
    await act(async () => options.action.onClick());
    expect(openReleasesPage).toHaveBeenCalledOnce();
  });

  it('does not repeat a release notification already shown on this workstation', async () => {
    localStorage.setItem(LAST_NOTIFIED_VERSION_KEY, '1.1.0');

    render(<ReleaseUpdateNotificationManager />);

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. View release' }),
    ).toBeVisible();
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
    expect(screen.queryByRole('button', { name: /is available\. View release/u })).toBeNull();
  });

  it('keeps GitHub failures silent in the renderer', async () => {
    checkForUpdates.mockResolvedValue({ success: false, error: 'unavailable' });

    render(<ReleaseUpdateNotificationManager />);

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. View release/u })).toBeNull();
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
    expect(screen.queryByRole('button', { name: /is available\. View release/u })).toBeNull();
  });

  it('fails closed when a partial bridge does not identify its runtime', async () => {
    vi.stubGlobal('api', {
      checkForUpdates,
      openReleasesPage,
    });

    render(<ReleaseUpdateNotificationManager />);
    await act(async () => undefined);

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /is available\. View release/u })).toBeNull();
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
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. View release' }),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. View release' }),
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
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. View release' }),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /is available\. View release/u })).toBeNull();
  });

  it('keeps the reminder visible and shows an error when the release page cannot open', async () => {
    openReleasesPage.mockResolvedValueOnce(false);
    render(<ReleaseUpdateNotificationManager />);

    const reminder = await screen.findByRole('button', {
      name: 'Relay v1.1.0 is available. View release',
    });
    fireEvent.click(reminder);

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
      screen.getByRole('button', { name: 'Relay v1.1.0 is available. View release' }),
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
      screen.getByRole('button', { name: 'Relay v1.2.0 is available. View release' }),
    ).toHaveTextContent('Update · v1.2.0');
    expect(localStorage.getItem(LAST_NOTIFIED_VERSION_KEY)).toBe('1.2.0');
  });
});
