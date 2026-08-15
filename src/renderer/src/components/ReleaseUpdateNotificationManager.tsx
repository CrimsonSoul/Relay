import { useEffect, useRef } from 'react';
import { useToast } from './Toast';

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
  const lastNotifiedVersionRef = useRef<string | null>(readLastNotifiedVersion());

  useEffect(() => {
    const api = globalThis.api;
    if (api?.runtime?.kind !== 'electron' || !api.checkForUpdates) return;

    let cancelled = false;
    const check = async () => {
      try {
        const result = await api.checkForUpdates?.();
        if (cancelled || !result?.success || !result.data?.updateAvailable) return;

        const latestVersion = result.data.latestVersion;
        if (lastNotifiedVersionRef.current === latestVersion) return;
        lastNotifiedVersionRef.current = latestVersion;
        rememberNotifiedVersion(latestVersion);

        showToast(`Relay v${latestVersion} is available.`, 'info', {
          title: 'Update available',
          durationMs: 12_000,
          action: {
            label: 'View release',
            onClick: () => {
              void api.openReleasesPage?.();
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
  }, [showToast]);

  return null;
}
