import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RelayReleaseNotes, RelayUpdateSnapshot } from '@shared/releases';
import { ReleaseUpdateModal } from '../ReleaseUpdateModal';

function snapshot(overrides: Partial<RelayUpdateSnapshot> = {}): RelayUpdateSnapshot {
  return {
    phase: 'available',
    currentVersion: '1.0.0',
    latestVersion: '1.1.0',
    installable: true,
    downloadedBytes: 0,
    totalBytes: 140_000_000,
    failureCode: null,
    ...overrides,
  };
}

const DEFAULT_RELEASE_NOTES: RelayReleaseNotes = {
  version: '1.1.0',
  title: 'Relay v1.1.0',
  body: '## Highlights\n\n- Faster update preparation\n- Clearer recovery messages',
  publishedAt: '2026-08-12T12:44:01Z',
  immutable: true,
};

function renderModal(
  update = snapshot(),
  releaseNotes: RelayReleaseNotes | null = DEFAULT_RELEASE_NOTES,
) {
  const actions = {
    onClose: vi.fn(),
    onDownload: vi.fn(),
    onCancelDownload: vi.fn(),
    onRevealInstaller: vi.fn(),
    onCheckAgain: vi.fn(),
    onOpenReleases: vi.fn(),
  };
  render(<ReleaseUpdateModal isOpen update={update} releaseNotes={releaseNotes} {...actions} />);
  return actions;
}

describe('ReleaseUpdateModal', () => {
  it('starts with explicit verified-download and manual-install steps', () => {
    const actions = renderModal();
    expect(screen.getByRole('dialog', { name: 'Update Relay' })).toBeVisible();
    expect(screen.getByText('v1.0.0 → v1.1.0')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Update steps' })).toHaveTextContent(
      'DownloadInstall manually',
    );
    expect(screen.getByText(/immutable GitHub release metadata/iu)).toBeVisible();
    expect(screen.getByText(/Publisher signing is not included/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    expect(actions.onDownload).toHaveBeenCalledOnce();
    expect(actions.onRevealInstaller).not.toHaveBeenCalled();
  });

  it('shows discovered release notes as structured content', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: "What's new in v1.1.0" })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Highlights' })).toBeVisible();
    expect(screen.getByText('Faster update preparation')).toBeVisible();
    expect(screen.getByText('Clearer recovery messages')).toBeVisible();
  });

  it('keeps the flow usable when release notes are unavailable', () => {
    renderModal(snapshot(), null);
    expect(
      screen.getByText(
        'Release notes are not available yet. You can still review this release on GitHub.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download update' })).toBeVisible();
  });

  it('shows bounded determinate progress and only a cancel action while downloading', () => {
    const actions = renderModal(snapshot({ phase: 'downloading', downloadedBytes: 70_000_000 }));
    const progress = screen.getByRole('progressbar', { name: 'Update download progress' });
    expect(progress.tagName).toBe('PROGRESS');
    expect(progress).toHaveAttribute('data-mode', 'determinate');
    expect(progress).toHaveAttribute('value', '70000000');
    expect(progress).toHaveAttribute('max', '140000000');
    expect(document.querySelector('.release-update-modal__progress-fill')).toHaveStyle({
      width: '50%',
    });
    expect(screen.getByText('66.8 MB of 133.5 MB')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Exit Relay and open installer folder' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    expect(actions.onCancelDownload).toHaveBeenCalledOnce();
  });

  it('offers the verified installer folder instead of automatic installation', () => {
    const actions = renderModal(snapshot({ phase: 'downloaded', downloadedBytes: 140_000_000 }));
    expect(screen.getByText(/Relay will exit and open the folder/iu)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart Relay' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exit Relay and open installer folder' }));
    expect(actions.onRevealInstaller).toHaveBeenCalledOnce();
  });

  it('keeps completed verification visible until the folder opens', () => {
    renderModal(snapshot({ phase: 'downloaded', downloadedBytes: 140_000_000 }));
    const progress = screen.getByRole('progressbar', { name: 'Update download complete' });
    expect(progress).toHaveAttribute('data-mode', 'determinate');
    expect(progress).toHaveAttribute('value', '140000000');
    expect(progress).toHaveAttribute('max', '140000000');
    expect(screen.getByText('133.5 MB verified')).toBeVisible();
  });

  it('keeps a failed folder reveal retryable without redownloading', () => {
    const actions = renderModal(
      snapshot({ phase: 'error', failureCode: 'reveal-failed', downloadedBytes: 140_000_000 }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The verified download is still available.',
    );
    expect(screen.queryByRole('button', { name: 'Retry download' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Exit Relay and open installer folder' }));
    expect(actions.onRevealInstaller).toHaveBeenCalledOnce();
  });

  it('offers review but no download for a mutable release', () => {
    const actions = renderModal(snapshot({ installable: false, totalBytes: null }));
    expect(screen.getByText(/cannot download it because GitHub has not locked it/iu)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View on GitHub' }));
    expect(actions.onOpenReleases).toHaveBeenCalledOnce();
  });

  it('names verification failures and offers a deliberate retry', () => {
    const actions = renderModal(snapshot({ phase: 'error', failureCode: 'verification-failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The downloaded files did not pass integrity checks and were discarded.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    expect(actions.onDownload).toHaveBeenCalledOnce();
  });

  it('refreshes discovery when GitHub changes the release mid-flow', () => {
    const actions = renderModal(snapshot({ phase: 'error', failureCode: 'release-changed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(actions.onCheckAgain).toHaveBeenCalledOnce();
  });
});
