import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayReleaseNotes } from '@shared/releases';
import { TactileButton } from '../TactileButton';
import { ReleaseNotesContent } from '../release-notes/ReleaseNotesContent';
import { RecoverySettings } from './RecoverySettings';

function formatReleaseDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function AboutSettings() {
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [openError, setOpenError] = useState(false);
  const [releases, setReleases] = useState<RelayReleaseNotes[]>([]);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [notesState, setNotesState] = useState<
    'loading' | 'ready' | 'refreshing' | 'stale' | 'error'
  >('loading');
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

  const loadReleaseNotes = useCallback(async () => {
    const api = globalThis.api;
    if (!api?.getCachedReleaseNotes || !api.refreshReleaseNotes) {
      setNotesState('error');
      return;
    }

    let cached: RelayReleaseNotes[] = [];
    try {
      cached = await api.getCachedReleaseNotes();
      setReleases(cached);
      setExpandedVersion((current) => current ?? cached[0]?.version ?? null);
      setNotesState(cached.length > 0 ? 'refreshing' : 'loading');
    } catch {
      setNotesState('loading');
    }

    try {
      const refreshed = await api.refreshReleaseNotes();
      if (!refreshed.success || !refreshed.data) throw new Error('refresh unavailable');
      setReleases(refreshed.data);
      setExpandedVersion((current) =>
        refreshed.data?.some((release) => release.version === current)
          ? current
          : (refreshed.data?.[0]?.version ?? null),
      );
      setNotesState('ready');
    } catch {
      setNotesState(cached.length > 0 ? 'stale' : 'error');
    }
  }, []);

  useEffect(() => {
    void loadReleaseNotes();
  }, [loadReleaseNotes]);

  const handleOpenReleases = async (releaseVersion?: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpenError(false);
    try {
      const opened = await globalThis.api?.openReleasesPage?.(releaseVersion);
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

      <RecoverySettings />

      <div className="settings-release-history__heading">
        <div>
          <h3>Release notes</h3>
          <p>Recent stable Relay releases, saved on this workstation for offline reference.</p>
        </div>
        {notesState === 'refreshing' && (
          <output className="settings-release-history__status" aria-live="polite">
            Checking for newer notes…
          </output>
        )}
      </div>

      {notesState === 'loading' && releases.length === 0 && (
        <output className="settings-release-history__empty" aria-live="polite">
          Loading saved release notes…
        </output>
      )}
      {notesState === 'error' && releases.length === 0 && (
        <div className="settings-release-history__empty" role="alert">
          <span>Release notes have not been downloaded on this workstation yet.</span>
          <TactileButton type="button" size="sm" onClick={() => void loadReleaseNotes()}>
            Try again
          </TactileButton>
        </div>
      )}
      {notesState === 'stale' && releases.length > 0 && (
        <div className="settings-release-history__offline" role="status">
          <span>Showing saved release notes. GitHub refresh unavailable.</span>
          <TactileButton type="button" size="sm" onClick={() => void loadReleaseNotes()}>
            Try again
          </TactileButton>
        </div>
      )}

      {releases.length > 0 && (
        <div className="settings-release-history">
          {releases.map((release, index) => {
            const expanded = expandedVersion === release.version;
            const panelId = `settings-release-${release.version.replaceAll('.', '-')}`;
            return (
              <article className="settings-release" key={release.version}>
                <button
                  type="button"
                  className="settings-release__summary"
                  aria-label={`Relay v${release.version} release notes`}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setExpandedVersion(expanded ? null : release.version)}
                >
                  <span className="settings-release__version">v{release.version}</span>
                  <span className="settings-release__summary-copy">
                    <strong>{release.title}</strong>
                    <time dateTime={release.publishedAt}>
                      {formatReleaseDate(release.publishedAt)}
                    </time>
                  </span>
                  <span className="settings-release__badges">
                    {index === 0 && <span className="settings-release__badge">Latest</span>}
                    {version === release.version && (
                      <span className="settings-release__badge settings-release__badge--installed">
                        Installed
                      </span>
                    )}
                  </span>
                  <svg
                    className="settings-release__chevron"
                    viewBox="0 0 16 16"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </button>
                {expanded && (
                  <div id={panelId} className="settings-release__panel">
                    <ReleaseNotesContent
                      body={release.body}
                      className="settings-release__content release-notes-content"
                    />
                    <TactileButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleOpenReleases(release.version)}
                    >
                      View v{release.version} on GitHub
                    </TactileButton>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
