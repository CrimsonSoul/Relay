import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { AboutSettings } from './AboutSettings';

vi.mock('./RecoverySettings', () => ({
  RecoverySettings: () => null,
}));

describe('AboutSettings', () => {
  const getAppVersion = vi.fn().mockResolvedValue('1.0.0');
  const openReleasesPage = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    getAppVersion.mockResolvedValue('1.0.0');
    openReleasesPage.mockResolvedValue(true);
    vi.stubGlobal('api', {
      runtime: ELECTRON_RUNTIME,
      getAppVersion,
      openReleasesPage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the exact installed release version reported by Electron', async () => {
    render(<AboutSettings />);

    expect(screen.getByRole('heading', { name: 'About Relay' })).toBeVisible();
    expect(await screen.findByText('v1.0.0')).toBeVisible();
    expect(screen.getByText('Installed version')).toBeVisible();
  });

  it('opens the fixed GitHub releases action from Settings', async () => {
    render(<AboutSettings />);
    await screen.findByText('v1.0.0');

    fireEvent.click(screen.getByRole('button', { name: 'View Releases' }));

    await waitFor(() => expect(openReleasesPage).toHaveBeenCalledOnce());
  });

  it('keeps the external-link button geometry stable during the browser handoff', async () => {
    let finishOpen!: (opened: boolean) => void;
    openReleasesPage.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishOpen = resolve;
        }),
    );
    render(<AboutSettings />);
    await screen.findByText('v1.0.0');

    const button = screen.getByRole('button', { name: 'View Releases' });
    fireEvent.click(button);

    try {
      expect(button).toBeEnabled();
      expect(button).not.toHaveClass('is-loading');
      expect(button.querySelector('.tactile-button-spinner')).toBeNull();
    } finally {
      await act(async () => finishOpen(true));
    }
  });

  it('keeps the release action available when the version cannot be read', async () => {
    getAppVersion.mockResolvedValue(null);

    render(<AboutSettings />);

    expect(await screen.findByText('Version unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'View Releases' })).toBeEnabled();
  });

  it('shows a recoverable inline error when GitHub cannot be opened', async () => {
    openReleasesPage.mockResolvedValue(false);
    render(<AboutSettings />);
    await screen.findByText('v1.0.0');

    fireEvent.click(screen.getByRole('button', { name: 'View Releases' }));

    expect(
      await screen.findByText(
        'Could not open GitHub Releases. Check your connection and try again.',
      ),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('button', { name: 'View Releases' })).toBeEnabled();
  });

  it('announces the release-notes check through a status output that stays mounted', async () => {
    const release = {
      version: '1.0.0',
      title: 'Relay 1.0.0',
      body: 'Notes',
      publishedAt: '2026-01-01T00:00:00Z',
      immutable: true,
    };
    let finishRefresh!: (result: { success: boolean; data: (typeof release)[] }) => void;
    vi.stubGlobal('api', {
      runtime: ELECTRON_RUNTIME,
      getAppVersion,
      openReleasesPage,
      getCachedReleaseNotes: vi.fn().mockResolvedValue([release]),
      refreshReleaseNotes: vi.fn(
        () =>
          new Promise((resolve) => {
            finishRefresh = resolve;
          }),
      ),
    });
    render(<AboutSettings />);

    const status = await screen.findByText('Checking for newer notes…');
    expect(status.tagName).toBe('OUTPUT');
    expect(status).not.toHaveAttribute('aria-live');
    expect(status).toHaveClass('settings-release-history__status');

    await act(async () => finishRefresh({ success: true, data: [release] }));

    expect(status).toBeInTheDocument();
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveClass('sr-only');
    const installed = screen.getByText('Installed version').parentElement as HTMLElement;
    expect(installed.querySelector('[aria-live]')).toBeNull();
  });
});
