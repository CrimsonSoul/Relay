import { useEffect, useRef, useState } from 'react';
import { TactileButton } from '../TactileButton';

export function AboutSettings() {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [openError, setOpenError] = useState(false);
  const openingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void globalThis.api
      ?.getAppVersion?.()
      .then((installedVersion) => {
        if (!cancelled) setVersion(installedVersion);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenReleases = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpenError(false);
    try {
      const opened = await globalThis.api?.openReleasesPage?.();
      if (!opened) setOpenError(true);
    } catch {
      setOpenError(true);
    } finally {
      openingRef.current = false;
    }
  };

  let versionLabel = 'Reading installed version…';
  if (version === null) versionLabel = 'Version unavailable';
  else if (version) versionLabel = `v${version}`;

  return (
    <section className="settings-section settings-about" aria-labelledby="settings-about-title">
      <h2 id="settings-about-title" className="settings-section-heading">
        About Relay
      </h2>
      <div className="settings-about__version-row">
        <div className="settings-about__version-stack">
          <span className="settings-about__label">Installed version</span>
          <strong className="settings-about__version" aria-live="polite">
            {versionLabel}
          </strong>
        </div>
        <TactileButton type="button" size="sm" onClick={() => void handleOpenReleases()}>
          View releases
        </TactileButton>
      </div>
      <p className="settings-about__copy">
        Release notes and verified Windows installers are published from Relay’s protected test
        branch on GitHub.
      </p>
      {openError && (
        <p className="settings-about__error" role="alert">
          Could not open GitHub Releases. Check your connection and try again.
        </p>
      )}
    </section>
  );
}
