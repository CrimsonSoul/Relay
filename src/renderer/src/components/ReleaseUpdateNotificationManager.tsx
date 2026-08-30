import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayReleaseNotes, RelayUpdateCheck, RelayUpdateSnapshot } from '@shared/releases';
import { useToast } from './Toast';
import { TactileButton } from './TactileButton';
import { ReleaseUpdateModal } from './ReleaseUpdateModal';

const LAST_NOTIFIED_VERSION_KEY = 'relay:lastNotifiedReleaseVersion';
const CHECK_INTERVAL_MS = 15 * 60 * 1_000;

function readLastNotifiedVersion(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_NOTIFIED_VERSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function rememberNotifiedVersion(version: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_NOTIFIED_VERSION_KEY, version);
  } catch {
    // The in-memory ref still prevents duplicates for this running session.
  }
}

function advisorySnapshot(update: RelayUpdateCheck): RelayUpdateSnapshot {
  return {
    phase: 'available',
    currentVersion: update.currentVersion,
    latestVersion: update.latestVersion,
    installable: update.installable === true,
    downloadedBytes: 0,
    totalBytes: update.assetSizeBytes ?? null,
    failureCode: null,
  };
}

function indicatorPresentation(update: RelayUpdateSnapshot): {
  label: string;
  ariaLabel: string;
} {
  const version = update.latestVersion ?? update.currentVersion;
  switch (update.phase) {
    case 'downloading':
      return {
        label: 'Downloading',
        ariaLabel: `Relay v${version} is downloading. Review update`,
      };
    case 'downloaded':
      return {
        label: 'Ready',
        ariaLabel: `Relay v${version} is verified and ready. Review update`,
      };
    case 'error':
      return {
        label: 'Update issue',
        ariaLabel: `Relay v${version} needs update attention. Review update`,
      };
    case 'available':
    case 'idle':
      return {
        label: 'Update',
        ariaLabel: `Relay v${version} is available. Review update`,
      };
  }
}

function supportsManualUpdateFlow(): boolean {
  const api = globalThis.api;
  return Boolean(
    api?.getUpdateState &&
    api.downloadUpdate &&
    api.cancelUpdateDownload &&
    api.revealUpdateInstaller,
  );
}

export function ReleaseUpdateNotificationManager() {
  const { showToast } = useToast();
  const [update, setUpdate] = useState<RelayUpdateSnapshot | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<RelayReleaseNotes | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const lastNotifiedVersionRef = useRef<string | null>(readLastNotifiedVersion());
  const openingRef = useRef(false);
  const actionRef = useRef(false);
  const cancelActionRef = useRef(false);
  const mountedRef = useRef(true);

  const handleOpenReleases = useCallback(
    async (version?: string) => {
      if (openingRef.current) return;
      openingRef.current = true;
      try {
        const opened = await globalThis.api?.openReleasesPage?.(version);
        if (!opened) throw new Error('Release page did not open');
      } catch {
        showToast('Could not open GitHub Releases. Check your connection and try again.', 'error', {
          title: 'Release page unavailable',
        });
      } finally {
        openingRef.current = false;
      }
    },
    [showToast],
  );

  const handleReviewUpdate = useCallback(() => {
    if (supportsManualUpdateFlow()) {
      setIsModalOpen(true);
      return;
    }
    void handleOpenReleases();
  }, [handleOpenReleases]);

  const checkForRelease = useCallback(async () => {
    const api = globalThis.api;
    if (api?.runtime?.kind !== 'electron' || !api.checkForUpdates) return;
    try {
      const result = await api.checkForUpdates();
      const next = result.success ? result.data : undefined;
      if (!mountedRef.current || !next) return;
      if (!next.updateAvailable) {
        setUpdate(null);
        setReleaseNotes(null);
        setIsModalOpen(false);
        return;
      }

      setReleaseNotes((current) => {
        if (next.releaseNotes?.version === next.latestVersion) return next.releaseNotes;
        return current?.version === next.latestVersion ? current : null;
      });

      const fallback = advisorySnapshot(next);
      setUpdate((current) => {
        if (
          current?.latestVersion === fallback.latestVersion &&
          current.phase !== 'idle' &&
          (current.phase !== 'available' || current.failureCode !== null)
        ) {
          return current;
        }
        return fallback;
      });

      const latestVersion = next.latestVersion;
      if (lastNotifiedVersionRef.current === latestVersion) return;
      lastNotifiedVersionRef.current = latestVersion;
      rememberNotifiedVersion(latestVersion);
      showToast(`Relay v${latestVersion} is available.`, 'info', {
        title: 'Update available',
        durationMs: 12_000,
        action: {
          label: 'Review update',
          onClick: handleReviewUpdate,
        },
      });
    } catch {
      // Update discovery is advisory and must never interrupt Relay operations.
    }
  }, [handleReviewUpdate, showToast]);

  useEffect(() => {
    mountedRef.current = true;
    const api = globalThis.api;
    if (api?.runtime?.kind !== 'electron' || !api.checkForUpdates) return;

    let cancelled = false;
    const acceptSnapshot = (snapshot: RelayUpdateSnapshot) => {
      if (cancelled) return;
      setUpdate(snapshot.phase === 'idle' || !snapshot.latestVersion ? null : snapshot);
    };
    const unsubscribe = api.onUpdateStateChanged?.(acceptSnapshot);
    const initialize = async () => {
      try {
        const snapshot = await api.getUpdateState?.();
        if (snapshot) acceptSnapshot(snapshot);
      } catch {
        // A missing initial snapshot does not prevent advisory release discovery.
      }
      if (!cancelled) await checkForRelease();
    };

    void initialize();
    const interval = globalThis.setInterval(() => void checkForRelease(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      unsubscribe?.();
      globalThis.clearInterval(interval);
    };
  }, [checkForRelease]);

  const runSnapshotAction = useCallback(
    async (
      action: (() => Promise<{ success: boolean; data?: RelayUpdateSnapshot }>) | undefined,
      failureMessage: string,
    ) => {
      if (actionRef.current || !action) return;
      actionRef.current = true;
      try {
        const result = await action();
        if (!result.success || !result.data) throw new Error('Update action unavailable');
        if (mountedRef.current) setUpdate(result.data);
      } catch {
        showToast(failureMessage, 'error', { title: 'Update unavailable' });
      } finally {
        actionRef.current = false;
      }
    },
    [showToast],
  );

  const handleDownload = useCallback(() => {
    void runSnapshotAction(
      globalThis.api?.downloadUpdate,
      'Relay could not start the download. Check your connection and try again.',
    );
  }, [runSnapshotAction]);

  const handleCancelDownload = useCallback(async () => {
    if (cancelActionRef.current) return;
    cancelActionRef.current = true;
    try {
      const result = await globalThis.api?.cancelUpdateDownload?.();
      if (!result?.success || !result.data) throw new Error('Update cancellation unavailable');
      if (mountedRef.current) setUpdate(result.data);
    } catch {
      showToast('Relay could not cancel the download. Try again.', 'error', {
        title: 'Update unavailable',
      });
    } finally {
      cancelActionRef.current = false;
    }
  }, [showToast]);

  const handleRevealInstaller = useCallback(async () => {
    if (actionRef.current) return;
    actionRef.current = true;
    try {
      const result = await globalThis.api?.revealUpdateInstaller?.();
      if (!result?.success || !result.data || result.data.phase !== 'downloaded') {
        throw new Error('Verified installer folder unavailable');
      }
      if (mountedRef.current) setUpdate(result.data);
    } catch {
      showToast('Relay could not open the verified installer folder. Try again.', 'error', {
        title: 'Installer folder unavailable',
      });
    } finally {
      actionRef.current = false;
    }
  }, [showToast]);

  if (!update?.latestVersion) return null;
  const indicator = indicatorPresentation(update);

  return (
    <>
      <TactileButton
        size="sm"
        className="release-update-indicator"
        icon={<span className="release-update-indicator__dot" aria-hidden="true" />}
        aria-label={indicator.ariaLabel}
        data-phase={update.phase}
        onClick={handleReviewUpdate}
      >
        <span className="release-update-indicator__wide-label">{indicator.label} · </span>
        <span className="release-update-indicator__version">v{update.latestVersion}</span>
      </TactileButton>
      <ReleaseUpdateModal
        isOpen={isModalOpen}
        update={update}
        releaseNotes={releaseNotes}
        onClose={() => setIsModalOpen(false)}
        onDownload={handleDownload}
        onCancelDownload={() => void handleCancelDownload()}
        onRevealInstaller={() => void handleRevealInstaller()}
        onCheckAgain={() => void checkForRelease()}
        onOpenReleases={() => void handleOpenReleases(update.latestVersion ?? undefined)}
      />
    </>
  );
}
