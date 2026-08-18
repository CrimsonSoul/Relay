import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from './Toast';
import { TactileButton } from './TactileButton';

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

export function ReleaseUpdateNotificationManager() {
  const { showToast } = useToast();
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const lastNotifiedVersionRef = useRef<string | null>(readLastNotifiedVersion());
  const openingRef = useRef(false);

  const handleOpenReleases = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const opened = await globalThis.api?.openReleasesPage?.();
      if (!opened) throw new Error('Release page did not open');
    } catch {
      showToast('Could not open GitHub Releases. Check your connection and try again.', 'error', {
        title: 'Release page unavailable',
      });
    } finally {
      openingRef.current = false;
    }
  }, [showToast]);

  useEffect(() => {
    const api = globalThis.api;
    if (api?.runtime?.kind !== 'electron' || !api.checkForUpdates) return;

    let cancelled = false;
    const check = async () => {
      try {
        const result = await api.checkForUpdates?.();
        const update = result?.success ? result.data : undefined;
        if (cancelled || !update) return;
        if (!update.updateAvailable) {
          setAvailableVersion(null);
          return;
        }

        const latestVersion = update.latestVersion;
        setAvailableVersion(latestVersion);
        if (lastNotifiedVersionRef.current === latestVersion) return;
        lastNotifiedVersionRef.current = latestVersion;
        rememberNotifiedVersion(latestVersion);

        showToast(`Relay v${latestVersion} is available.`, 'info', {
          title: 'Update available',
          durationMs: 12_000,
          action: {
            label: 'View release',
            onClick: () => {
              void handleOpenReleases();
            },
          },
        });
      } catch {
        // Update discovery is advisory and must never interrupt Relay operations.
      }
    };

    void check();
    const interval = globalThis.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [handleOpenReleases, showToast]);

  if (!availableVersion) return null;

  return (
    <TactileButton
      size="sm"
      className="release-update-indicator"
      icon={<span className="release-update-indicator__dot" aria-hidden="true" />}
      aria-label={`Relay v${availableVersion} is available. View release`}
      onClick={() => void handleOpenReleases()}
    >
      <span className="release-update-indicator__wide-label">Update · </span>
      <span className="release-update-indicator__version">v{availableVersion}</span>
    </TactileButton>
  );
}
