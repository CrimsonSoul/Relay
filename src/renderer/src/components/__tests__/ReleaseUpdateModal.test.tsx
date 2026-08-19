import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RelayUpdateSnapshot } from '@shared/releases';
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

function renderModal(update = snapshot()) {
  const actions = {
    onClose: vi.fn(),
    onDownload: vi.fn(),
    onCancelDownload: vi.fn(),
    onInstall: vi.fn(),
    onRestart: vi.fn(),
    onCheckAgain: vi.fn(),
    onOpenReleases: vi.fn(),
  };
  render(<ReleaseUpdateModal isOpen update={update} {...actions} />);
  return actions;
}

describe('ReleaseUpdateModal', () => {
  it('starts with an explicit download action and explains the GitHub trust model', () => {
    const actions = renderModal();

    expect(screen.getByRole('dialog', { name: 'Update Relay' })).toBeVisible();
    expect(screen.getByText('v1.0.0 → v1.1.0')).toBeVisible();
    expect(screen.getByRole('list', { name: 'Update steps' })).toHaveTextContent(
      'DownloadInstallRestart',
    );
    expect(screen.getByText(/immutable GitHub release metadata/iu)).toBeVisible();
    expect(screen.getByText(/Publisher signing is not included/u)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    expect(actions.onDownload).toHaveBeenCalledOnce();
    expect(actions.onInstall).not.toHaveBeenCalled();
    expect(actions.onRestart).not.toHaveBeenCalled();
  });

  it('shows bounded byte progress and only a cancel action while downloading', () => {
    const actions = renderModal(snapshot({ phase: 'downloading', downloadedBytes: 70_000_000 }));

    expect(screen.getByRole('progressbar', { name: 'Update download progress' })).toHaveAttribute(
      'value',
      '70000000',
    );
    expect(screen.getByText('66.8 MB of 133.5 MB')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View on GitHub' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    expect(actions.onCancelDownload).toHaveBeenCalledOnce();
  });

  it('keeps installation as a separate operator decision after download', () => {
    const actions = renderModal(
      snapshot({
        phase: 'downloaded',
        downloadedBytes: 140_000_000,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Install update' }));
    expect(actions.onInstall).toHaveBeenCalledOnce();
    expect(actions.onRestart).not.toHaveBeenCalled();
  });

  it('uses native output semantics for non-error live status updates', () => {
    renderModal(snapshot({ phase: 'installing' }));

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    for (const status of statuses) expect(status.tagName).toBe('OUTPUT');
  });

  it('keeps focus contained when installation enters its non-dismissible busy state', async () => {
    const actions = {
      onClose: vi.fn(),
      onDownload: vi.fn(),
      onCancelDownload: vi.fn(),
      onInstall: vi.fn(),
      onRestart: vi.fn(),
      onCheckAgain: vi.fn(),
      onOpenReleases: vi.fn(),
    };
    const { rerender } = render(
      <ReleaseUpdateModal isOpen update={snapshot({ phase: 'downloaded' })} {...actions} />,
    );
    screen.getByRole('button', { name: 'Install update' }).focus();

    rerender(<ReleaseUpdateModal isOpen update={snapshot({ phase: 'installing' })} {...actions} />);

    const dialog = screen.getByRole('dialog', { name: 'Update Relay' });
    expect(screen.getByText('Preparing update…')).toBeVisible();
    const reviewAction = screen.getByRole('button', { name: 'View on GitHub' });
    await waitFor(() => expect(reviewAction).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(reviewAction).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('keeps restart as a separate operator decision after installation', () => {
    const actions = renderModal(snapshot({ phase: 'ready-to-restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart Relay' }));
    expect(actions.onRestart).toHaveBeenCalledOnce();
    expect(actions.onInstall).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'View on GitHub' })).toBeVisible();
  });

  it('offers review but never installation for a release GitHub has not made immutable', () => {
    const actions = renderModal(snapshot({ installable: false, totalBytes: null }));

    expect(
      screen.getByText(/cannot install it because GitHub has not locked it as immutable/u),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View on GitHub' }));
    expect(actions.onOpenReleases).toHaveBeenCalledOnce();
  });

  it('explains when this Relay runtime does not support in-app installation', () => {
    renderModal(
      snapshot({
        installable: false,
        failureCode: 'unsupported',
      }),
    );

    expect(screen.getByText(/only in packaged Relay for Windows x64/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View on GitHub' })).toBeVisible();
  });

  it('names verification failures and offers a deliberate retry', () => {
    const actions = renderModal(snapshot({ phase: 'error', failureCode: 'verification-failed' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The downloaded files did not pass integrity checks and were discarded.',
    );
    expect(screen.getByRole('button', { name: 'View on GitHub' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    expect(actions.onDownload).toHaveBeenCalledOnce();
  });

  it('refreshes discovery when GitHub changes the latest release mid-flow', () => {
    const actions = renderModal(snapshot({ phase: 'error', failureCode: 'release-changed' }));

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(actions.onCheckAgain).toHaveBeenCalledOnce();
  });
});
