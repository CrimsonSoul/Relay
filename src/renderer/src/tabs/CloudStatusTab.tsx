import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downdetectorUrl, type CloudStatusData, type MistCloudStatusProvider } from '@shared/ipc';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { TactileButton } from '../components/TactileButton';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { CURRENT_CLOUD_OUTAGE_WINDOW_MS, isCurrentCloudIssue } from '../utils/cloudStatus';
import {
  aggregateCloudStatusForDisplay,
  DISPLAY_CLOUD_STATUS_PORTALS,
  DISPLAY_CLOUD_STATUS_PORTAL_ORDER,
  DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
  DISPLAY_CLOUD_STATUS_PROVIDERS,
  DISPLAY_MIST_REGION_OPTIONS,
  type DisplayCloudStatusItem,
  type DisplayCloudStatusPortalProvider,
  type DisplayCloudStatusProvider,
} from '../utils/cloudStatusDisplay';

type ProviderPosture = 'outage' | 'degraded' | 'unknown' | 'clear';
type MistRegionFilter = 'all' | MistCloudStatusProvider;
const MAX_TIMEOUT_MS = 2_147_483_647;

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function lastUpdatedLabel(timestamp: number): string {
  if (!timestamp) return 'Never';
  return timeAgo(new Date(timestamp).toISOString());
}

function providerLabel(provider: DisplayCloudStatusProvider): string {
  return DISPLAY_CLOUD_STATUS_PROVIDERS[provider].label;
}

function providerPortalLabel(provider: DisplayCloudStatusPortalProvider): string {
  return DISPLAY_CLOUD_STATUS_PORTALS[provider].label;
}

function formatLocalTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function stripHtml(html: string): string {
  const decoded = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  return new DOMParser().parseFromString(decoded, 'text/html').body.textContent ?? '';
}

function providerPosture(
  hasOutage: boolean,
  hasDegradation: boolean,
  hasFeedError: boolean,
): ProviderPosture {
  if (hasOutage) return 'outage';
  if (hasFeedError) return 'unknown';
  if (hasDegradation) return 'degraded';
  return 'clear';
}

function postureLabel(posture: ProviderPosture): string {
  if (posture === 'outage') return 'Outage';
  if (posture === 'degraded') return 'Degraded';
  if (posture === 'unknown') return 'Unknown';
  return 'Operational';
}

function postureRank(posture: ProviderPosture): number {
  if (posture === 'outage') return 0;
  if (posture === 'unknown') return 1;
  if (posture === 'degraded') return 2;
  return 3;
}

function outageCountLabel(count: number): string {
  return `${count} active ${count === 1 ? 'outage' : 'outages'}`;
}

function degradedCountLabel(count: number): string {
  return `${count} degraded ${count === 1 ? 'issue' : 'issues'}`;
}

function providerIssueCountLabel(count: number): string {
  if (count === 0) return 'No active issues';
  return `${count} active ${count === 1 ? 'issue' : 'issues'}`;
}

function providerDetailCountLabel(count: number, unavailable: boolean): string {
  if (count > 0) return providerIssueCountLabel(count);
  return unavailable ? 'Coverage unavailable' : 'No active issues';
}

function providerDetailDescription(count: number, unavailable: boolean): string {
  if (unavailable) return 'Relay cannot currently verify this provider feed.';
  if (count === 0) return 'No current outage or degradation is reported.';
  return 'Current provider incidents, ordered newest first.';
}

function activeIssueCountLabel(outageCount: number, degradedCount: number): string {
  const labels: string[] = [];
  if (outageCount > 0) labels.push(outageCountLabel(outageCount));
  if (degradedCount > 0) labels.push(degradedCountLabel(degradedCount));
  return labels.length > 0 ? labels.join(' · ') : 'No active vendor issues';
}

function sortProviders(
  providers: readonly DisplayCloudStatusProvider[],
  outageProviders: ReadonlySet<DisplayCloudStatusProvider>,
  degradedProviders: ReadonlySet<DisplayCloudStatusProvider>,
  errorProviders: ReadonlySet<DisplayCloudStatusProvider>,
): DisplayCloudStatusProvider[] {
  return [...providers].sort((a, b) => {
    const aRank = postureRank(
      providerPosture(outageProviders.has(a), degradedProviders.has(a), errorProviders.has(a)),
    );
    const bRank = postureRank(
      providerPosture(outageProviders.has(b), degradedProviders.has(b), errorProviders.has(b)),
    );
    return aRank - bRank || providers.indexOf(a) - providers.indexOf(b);
  });
}

const ProviderActions: React.FC<{ provider: DisplayCloudStatusProvider }> = ({ provider }) => {
  const config = DISPLAY_CLOUD_STATUS_PROVIDERS[provider];
  // Read out of the config object so the guard narrows inside the click handler below.
  const downdetectorSlug = config.downdetectorSlug;
  const officialSupportUrl = config.officialSupportUrl;
  return (
    <div className="cloud-status-provider__actions">
      <button
        type="button"
        onClick={() => void globalThis.api?.openExternal(config.statusUrl)}
        aria-label={
          config.statusSourceLabel
            ? `Open ${providerLabel(provider)} on ${config.statusSourceLabel}`
            : `Open ${providerLabel(provider)} official status page`
        }
      >
        {config.statusSourceLabel ?? 'Status'}
      </button>
      {officialSupportUrl && (
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(officialSupportUrl)}
          aria-label={`Open ${providerLabel(provider)} official support portal`}
        >
          Official support
        </button>
      )}
      {config.twitterHandle && (
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(`https://x.com/${config.twitterHandle}`)}
          aria-label={`Open ${providerLabel(provider)} on X`}
        >
          @{config.twitterHandle}
        </button>
      )}
      {downdetectorSlug && (
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(downdetectorUrl(downdetectorSlug))}
          aria-label={`Open ${providerLabel(provider)} on Downdetector`}
        >
          Downdetector
        </button>
      )}
    </div>
  );
};

const ProviderRow: React.FC<{
  provider: DisplayCloudStatusProvider;
  hasOutage: boolean;
  hasDegradation: boolean;
  hasFeedError: boolean;
  issueCount: number;
  onSelect: (provider: DisplayCloudStatusProvider) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}> = ({ provider, hasOutage, hasDegradation, hasFeedError, issueCount, onSelect, buttonRef }) => {
  const posture = providerPosture(hasOutage, hasDegradation, hasFeedError);
  const stateId = `cloud-status-${provider}-state`;
  const countId = `cloud-status-${provider}-count`;
  return (
    <article className={`cloud-status-provider cloud-status-provider--${posture}`}>
      <button
        ref={buttonRef}
        type="button"
        className="cloud-status-provider__open"
        onClick={() => onSelect(provider)}
        aria-label={`View ${providerLabel(provider)} status details`}
        aria-describedby={`${stateId} ${countId}`}
      >
        <span
          className={`cloud-status-provider__signal cloud-status-provider__signal--${posture}`}
          aria-hidden="true"
        />
        <span className="cloud-status-provider__identity">
          <span className="cloud-status-provider__name">
            <ProviderIcon provider={provider} size={16} />
            {providerLabel(provider)}
          </span>
          <span id={countId} className="cloud-status-provider__count">
            {DISPLAY_CLOUD_STATUS_PROVIDERS[provider].statusSourceLabel && (
              <>
                <span className="cloud-status-provider__source">Third-party</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {providerDetailCountLabel(issueCount, hasFeedError)}
          </span>
        </span>
        <span
          id={stateId}
          className={`cloud-status-provider__state cloud-status-provider__state--${posture}`}
        >
          {postureLabel(posture)}
        </span>
        <span className="cloud-status-provider__chevron" aria-hidden="true">
          ›
        </span>
      </button>
    </article>
  );
};

const ProviderPortalRow: React.FC<{ provider: DisplayCloudStatusPortalProvider }> = ({
  provider,
}) => {
  const portal = DISPLAY_CLOUD_STATUS_PORTALS[provider];
  const stateId = `cloud-status-${provider}-portal-state`;
  const accessId = `cloud-status-${provider}-portal-access`;
  return (
    <article className="cloud-status-provider cloud-status-provider--portal">
      <button
        type="button"
        className="cloud-status-provider__open"
        onClick={() => void globalThis.api?.openExternal(portal.statusUrl)}
        aria-label={`Open ${providerPortalLabel(provider)} public status page`}
        aria-describedby={`${accessId} ${stateId}`}
      >
        <span
          className="cloud-status-provider__signal cloud-status-provider__signal--portal"
          aria-hidden="true"
        />
        <span className="cloud-status-provider__identity">
          <span className="cloud-status-provider__name">
            <ProviderIcon provider={provider} size={16} />
            {providerPortalLabel(provider)}
          </span>
          <span id={accessId} className="cloud-status-provider__count">
            {portal.accessLabel}
          </span>
        </span>
        <span
          id={stateId}
          className="cloud-status-provider__state cloud-status-provider__state--portal"
        >
          Portal
        </span>
        <span className="cloud-status-provider__chevron" aria-hidden="true">
          ↗
        </span>
      </button>
    </article>
  );
};

const OutageRow: React.FC<{ item: DisplayCloudStatusItem }> = ({ item }) => {
  const description = useMemo(() => stripHtml(item.description), [item.description]);
  const degraded = item.severity === 'warning';
  const severityLabel = degraded ? 'Degraded' : 'Outage';
  const sourceLabel = DISPLAY_CLOUD_STATUS_PROVIDERS[item.provider].statusSourceLabel;
  return (
    <article className={`cloud-status-outage${degraded ? ' cloud-status-outage--degraded' : ''}`}>
      <div className="cloud-status-outage__meta">
        <span
          className={`cloud-status-outage__severity${
            degraded ? ' cloud-status-outage__severity--degraded' : ''
          }`}
        >
          {severityLabel}
        </span>
        <time dateTime={item.pubDate}>{formatLocalTime(item.pubDate)}</time>
      </div>
      <h3>{item.title}</h3>
      <p className="cloud-status-outage__description">
        {description || 'No additional details were published.'}
      </p>
      {item.affectedScopes.length > 0 && (
        <dl className="cloud-status-outage__affected">
          <dt>Affected</dt>
          <dd>{item.affectedScopes.join(' · ')}</dd>
        </dl>
      )}
      <button
        type="button"
        onClick={() =>
          void globalThis.api?.openExternal(
            item.link || DISPLAY_CLOUD_STATUS_PROVIDERS[item.provider].statusUrl,
          )
        }
      >
        {sourceLabel ? `View ${sourceLabel} report` : 'View official status'}{' '}
        {/* Keep text separate from the decorative glyph. */}
        <span aria-hidden="true">↗</span>
      </button>
    </article>
  );
};

type StatusSummary = {
  tone: ProviderPosture;
  label: string;
};

function statusSummary(
  outageCount: number,
  degradedCount: number,
  hasFeedErrors: boolean,
  snapshotUnavailable: boolean,
): StatusSummary {
  if (snapshotUnavailable) return { tone: 'unknown', label: 'Coverage unavailable' };
  if (outageCount > 0) {
    return { tone: 'outage', label: activeIssueCountLabel(outageCount, degradedCount) };
  }
  if (hasFeedErrors) return { tone: 'unknown', label: 'Coverage incomplete' };
  if (degradedCount > 0) {
    return { tone: 'degraded', label: degradedCountLabel(degradedCount) };
  }
  return { tone: 'clear', label: 'No active vendor issues' };
}

const CoverageStateIcon: React.FC<{ unknown: boolean }> = ({ unknown }) => (
  <svg
    className={`cloud-status__coverage-icon${unknown ? ' cloud-status__coverage-icon--unknown' : ''}`}
    width="40"
    height="40"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z" />
    {unknown ? (
      <>
        <path d="M12 8v5" />
        <path d="M12 17h.01" />
      </>
    ) : (
      <path d="m9 12 2 2 4-4" />
    )}
  </svg>
);

const FeedUnavailableNotice: React.FC<{
  hasFeedErrors: boolean;
  snapshotUnavailable: boolean;
}> = ({ hasFeedErrors, snapshotUnavailable }) => {
  if (!hasFeedErrors) return null;
  if (snapshotUnavailable) {
    return (
      <div className="cloud-status__notice" role="status">
        <strong>Provider status data is unavailable.</strong>
        <span>Refresh to try loading a current snapshot.</span>
      </div>
    );
  }
  return (
    <div className="cloud-status__notice" role="status">
      <strong>Some provider feeds are unavailable.</strong>
      <span>Last known data is shown where Relay has it.</span>
    </div>
  );
};

type ProviderHealthProps = {
  outageProviders: ReadonlySet<DisplayCloudStatusProvider>;
  degradedProviders: ReadonlySet<DisplayCloudStatusProvider>;
  errorProviders: ReadonlySet<DisplayCloudStatusProvider>;
};

type ProviderOverviewWorkspaceProps = ProviderHealthProps & {
  providerOrder: DisplayCloudStatusProvider[];
  providerIssueCounts: ReadonlyMap<DisplayCloudStatusProvider, number>;
  onSelectProvider: (provider: DisplayCloudStatusProvider) => void;
  onProviderButtonRef: (
    provider: DisplayCloudStatusProvider,
    node: HTMLButtonElement | null,
  ) => void;
};

type ProviderDetailWorkspaceProps = ProviderHealthProps & {
  issues: DisplayCloudStatusItem[];
  mistFeedErrorProviders: ReadonlySet<MistCloudStatusProvider>;
  selectedProvider: DisplayCloudStatusProvider | null;
  onShowOverview: () => void;
};

type StatusWorkspaceProps = ProviderOverviewWorkspaceProps & ProviderDetailWorkspaceProps;

const ProviderOverviewWorkspace: React.FC<ProviderOverviewWorkspaceProps> = ({
  providerOrder,
  providerIssueCounts,
  outageProviders,
  degradedProviders,
  errorProviders,
  onSelectProvider,
  onProviderButtonRef,
}) => (
  <div className="cloud-status__workspace cloud-status__workspace--overview">
    <div className="cloud-status__providers-panel">
      <section className="cloud-status__monitored-providers" aria-label="Provider overview">
        <div className="cloud-status__section-heading">
          <span>Provider overview</span>
          <span>{DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length} monitored</span>
        </div>
        <div className="cloud-status__provider-list">
          {providerOrder.map((provider) => (
            <ProviderRow
              key={provider}
              provider={provider}
              hasOutage={outageProviders.has(provider)}
              hasDegradation={degradedProviders.has(provider)}
              hasFeedError={errorProviders.has(provider)}
              issueCount={providerIssueCounts.get(provider) ?? 0}
              onSelect={onSelectProvider}
              buttonRef={(node) => onProviderButtonRef(provider, node)}
            />
          ))}
        </div>
      </section>
      <section className="cloud-status__provider-portals" aria-label="Provider portals">
        <div className="cloud-status__section-heading">
          <span>Provider portals</span>
          <span>{DISPLAY_CLOUD_STATUS_PORTAL_ORDER.length} public status page</span>
        </div>
        <div className="cloud-status__portal-list">
          {DISPLAY_CLOUD_STATUS_PORTAL_ORDER.map((provider) => (
            <ProviderPortalRow key={provider} provider={provider} />
          ))}
        </div>
      </section>
    </div>
  </div>
);

const ProviderDetailWorkspace: React.FC<ProviderDetailWorkspaceProps> = ({
  issues,
  mistFeedErrorProviders,
  outageProviders,
  degradedProviders,
  errorProviders,
  selectedProvider,
  onShowOverview,
}) => {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedMistRegion, setSelectedMistRegion] = useState<MistRegionFilter>('all');
  useEffect(() => {
    if (selectedProvider) backButtonRef.current?.focus();
  }, [selectedProvider]);

  if (!selectedProvider) return null;

  const providerIssues = issues.filter((item) => item.provider === selectedProvider);
  const activeMistRegion =
    selectedProvider === 'mist' && selectedMistRegion !== 'all'
      ? DISPLAY_MIST_REGION_OPTIONS.find(({ provider }) => provider === selectedMistRegion)
      : undefined;
  const selectedIssues = activeMistRegion
    ? providerIssues.filter((item) => item.affectedScopes.includes(activeMistRegion.label))
    : providerIssues;
  const postureForMistRegion = (region: MistRegionFilter): ProviderPosture => {
    if (region === 'all') {
      return providerPosture(
        outageProviders.has('mist'),
        degradedProviders.has('mist'),
        errorProviders.has('mist'),
      );
    }
    const regionLabel = DISPLAY_MIST_REGION_OPTIONS.find(
      ({ provider }) => provider === region,
    )?.label;
    const regionIssues = providerIssues.filter((item) =>
      regionLabel ? item.affectedScopes.includes(regionLabel) : false,
    );
    return providerPosture(
      regionIssues.some((item) => item.severity === 'error'),
      regionIssues.some((item) => item.severity === 'warning'),
      mistFeedErrorProviders.has(region),
    );
  };
  const posture =
    selectedProvider === 'mist'
      ? postureForMistRegion(selectedMistRegion)
      : providerPosture(
          outageProviders.has(selectedProvider),
          degradedProviders.has(selectedProvider),
          errorProviders.has(selectedProvider),
        );
  const label = providerLabel(selectedProvider);
  const detailLabel = activeMistRegion ? `${label} ${activeMistRegion.label}` : label;
  const unavailable = posture === 'unknown';
  const sourceLabel = DISPLAY_CLOUD_STATUS_PROVIDERS[selectedProvider].statusSourceLabel;

  return (
    <div className="cloud-status__workspace cloud-status__workspace--detail">
      <section className="cloud-status__provider-detail" aria-label={`${label} status details`}>
        <div className="cloud-status__section-heading cloud-status__section-heading--detail">
          <button
            ref={backButtonRef}
            type="button"
            className="cloud-status__back"
            onClick={onShowOverview}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            All providers
          </button>
          <span>{providerDetailCountLabel(selectedIssues.length, unavailable)}</span>
        </div>

        <div className="cloud-status__provider-detail-header">
          <div className="cloud-status__provider-detail-identity">
            <ProviderIcon provider={selectedProvider} size={22} />
            <div>
              <h3>{label}</h3>
              <p>{providerDetailDescription(selectedIssues.length, unavailable)}</p>
              {sourceLabel && (
                <p>
                  Status supplied by {sourceLabel}, not {label}.
                </p>
              )}
            </div>
          </div>
          <span className={`cloud-status-provider__state cloud-status-provider__state--${posture}`}>
            {postureLabel(posture)}
          </span>
          <ProviderActions provider={selectedProvider} />
        </div>

        {selectedProvider === 'mist' && (
          <fieldset className="cloud-status__region-filter">
            <legend className="sr-only">Juniper Mist regions</legend>
            {[{ provider: 'all' as const, label: 'All' }, ...DISPLAY_MIST_REGION_OPTIONS].map(
              (region) => {
                const regionPosture = postureForMistRegion(region.provider);
                return (
                  <button
                    key={region.provider}
                    type="button"
                    aria-label={`${region.label} ${postureLabel(regionPosture)}`}
                    aria-pressed={selectedMistRegion === region.provider}
                    onClick={() => setSelectedMistRegion(region.provider)}
                  >
                    <span>{region.label}</span>
                    <span
                      className={`cloud-status__region-state cloud-status__region-state--${regionPosture}`}
                    >
                      {postureLabel(regionPosture)}
                    </span>
                  </button>
                );
              },
            )}
          </fieldset>
        )}

        {selectedIssues.length > 0 ? (
          <div className="cloud-status__outage-list">
            {selectedIssues.map((item) => (
              <OutageRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="cloud-status__provider-detail-empty">
            <CoverageStateIcon unknown={unavailable} />
            <h3>
              {unavailable
                ? `Status feed unavailable for ${detailLabel}`
                : `No active issues for ${detailLabel}`}
            </h3>
            <p>
              {unavailable
                ? 'Use the provider links above to verify its current public status.'
                : 'Relay will surface new outages and degradations here when they are reported.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

const StatusWorkspace: React.FC<StatusWorkspaceProps> = (props) => {
  if (props.selectedProvider) {
    return <ProviderDetailWorkspace key={props.selectedProvider} {...props} />;
  }
  return <ProviderOverviewWorkspace {...props} />;
};

export const CloudStatusTab: React.FC<{
  statusData: CloudStatusData | null;
  loading: boolean;
  refetch: () => void;
  selectedProvider?: DisplayCloudStatusProvider | null;
  onSelectedProviderChange?: (provider: DisplayCloudStatusProvider | null) => void;
}> = ({
  statusData,
  loading,
  refetch,
  selectedProvider: controlledSelectedProvider,
  onSelectedProviderChange,
}) => {
  const [issueEvaluationTime, setIssueEvaluationTime] = useState(() => Date.now());
  const [internalSelectedProvider, setInternalSelectedProvider] =
    useState<DisplayCloudStatusProvider | null>(null);
  const selectedProvider =
    controlledSelectedProvider === undefined
      ? internalSelectedProvider
      : controlledSelectedProvider;
  const providerButtonRefs = useRef(new Map<DisplayCloudStatusProvider, HTMLButtonElement>());
  const focusReturnProviderRef = useRef<DisplayCloudStatusProvider | null>(null);
  const handleProviderButtonRef = useCallback(
    (provider: DisplayCloudStatusProvider, node: HTMLButtonElement | null) => {
      if (node) {
        providerButtonRefs.current.set(provider, node);
      } else {
        providerButtonRefs.current.delete(provider);
      }
    },
    [],
  );
  const handleSelectProvider = useCallback(
    (provider: DisplayCloudStatusProvider) => {
      if (controlledSelectedProvider === undefined) setInternalSelectedProvider(provider);
      onSelectedProviderChange?.(provider);
    },
    [controlledSelectedProvider, onSelectedProviderChange],
  );
  const handleShowOverview = useCallback(() => {
    focusReturnProviderRef.current = selectedProvider;
    if (controlledSelectedProvider === undefined) setInternalSelectedProvider(null);
    onSelectedProviderChange?.(null);
  }, [controlledSelectedProvider, onSelectedProviderChange, selectedProvider]);
  useEffect(() => {
    if (selectedProvider !== null) return;
    const provider = focusReturnProviderRef.current;
    if (!provider) return;
    focusReturnProviderRef.current = null;
    providerButtonRefs.current.get(provider)?.focus();
  }, [selectedProvider]);
  const displayStatus = useMemo(
    () => (statusData ? aggregateCloudStatusForDisplay(statusData) : null),
    [statusData],
  );
  const errorProviders = useMemo(
    () =>
      new Set(
        displayStatus
          ? displayStatus.errors.map((error) => error.provider)
          : DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
      ),
    [displayStatus],
  );
  const mistFeedErrorProviders = useMemo(
    () =>
      new Set(
        statusData
          ? statusData.errors
              .map((error) => error.provider)
              .filter((provider): provider is MistCloudStatusProvider =>
                DISPLAY_MIST_REGION_OPTIONS.some((region) => region.provider === provider),
              )
          : DISPLAY_MIST_REGION_OPTIONS.map(({ provider }) => provider),
      ),
    [statusData],
  );
  const issues = useMemo(
    () =>
      displayStatus
        ? Object.values(displayStatus.providers)
            .flat()
            .filter((item) => isCurrentCloudIssue(item, Math.max(issueEvaluationTime, Date.now())))
            .toSorted((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
        : [],
    [displayStatus, issueEvaluationTime],
  );
  const nextIssueExpiration = useMemo(
    () =>
      issues.reduce((earliest, item) => {
        const publishedAt = new Date(item.pubDate).getTime();
        const expiresAt = publishedAt + CURRENT_CLOUD_OUTAGE_WINDOW_MS + 1;
        return Math.min(earliest, expiresAt);
      }, Number.POSITIVE_INFINITY),
    [issues],
  );
  useEffect(() => {
    if (!Number.isFinite(nextIssueExpiration)) return;
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(1, nextIssueExpiration - Date.now()));
    const timeoutId = window.setTimeout(() => setIssueEvaluationTime(Date.now()), delay);
    return () => window.clearTimeout(timeoutId);
  }, [issueEvaluationTime, nextIssueExpiration]);
  const outageCount = useMemo(
    () => issues.filter((item) => item.severity === 'error').length,
    [issues],
  );
  const confirmedDegradations = useMemo(
    () =>
      issues.filter((item) => item.severity === 'warning' && !errorProviders.has(item.provider)),
    [errorProviders, issues],
  );
  const degradedCount = confirmedDegradations.length;
  const providerIssueCounts = useMemo(() => {
    const counts = new Map<DisplayCloudStatusProvider, number>();
    for (const item of issues) {
      counts.set(item.provider, (counts.get(item.provider) ?? 0) + 1);
    }
    return counts;
  }, [issues]);
  const outageProviders = useMemo(
    () => new Set(issues.filter((item) => item.severity === 'error').map((item) => item.provider)),
    [issues],
  );
  const degradedProviders = useMemo(
    () => new Set(confirmedDegradations.map((item) => item.provider)),
    [confirmedDegradations],
  );
  const providerOrder = useMemo(
    () =>
      sortProviders(
        DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
        outageProviders,
        degradedProviders,
        errorProviders,
      ),
    [degradedProviders, errorProviders, outageProviders],
  );

  if (!statusData && loading) return <TabFallback />;

  const snapshotUnavailable = statusData === null;
  const hasFeedErrors = errorProviders.size > 0;
  const updatedLabel = `Updated ${lastUpdatedLabel(statusData?.lastUpdated ?? 0)}`;
  const summary = statusSummary(outageCount, degradedCount, hasFeedErrors, snapshotUnavailable);
  let statusBarSummary = activeIssueCountLabel(outageCount, degradedCount);
  if (snapshotUnavailable) statusBarSummary = 'coverage unavailable';
  else if (hasFeedErrors && outageCount === 0) statusBarSummary = 'coverage incomplete';

  return (
    <div className="cloud-status">
      <TabPageHeader
        context="Service status"
        title="External Status"
        metadata={
          <span className="cloud-status__meta" role="status" aria-live="polite">
            <span>{DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length} providers</span>
            <span aria-hidden="true">·</span>
            <span>{updatedLabel}</span>
          </span>
        }
      />
      <TabCommandBar ariaLabel="Status actions">
        <TabCommandGroup kind="utility">
          <TactileButton
            variant="secondary"
            className="cloud-status__refresh"
            onClick={refetch}
            disabled={loading}
            aria-label="Refresh cloud status"
            tooltip={loading ? 'Refreshing cloud status' : 'Refresh cloud status'}
            icon={
              <svg
                className={loading ? 'cloud-status__refresh-icon--spinning' : ''}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
              </svg>
            }
          />
        </TabCommandGroup>
      </TabCommandBar>

      <div className={`cloud-status__summary cloud-status__summary--${summary.tone}`} role="status">
        <span className="cloud-status__summary-signal" aria-hidden="true" />
        <strong>{summary.label}</strong>
        <span>across {DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length} monitored providers</span>
      </div>

      <FeedUnavailableNotice
        hasFeedErrors={hasFeedErrors}
        snapshotUnavailable={snapshotUnavailable}
      />

      <StatusWorkspace
        issues={issues}
        providerOrder={providerOrder}
        providerIssueCounts={providerIssueCounts}
        outageProviders={outageProviders}
        degradedProviders={degradedProviders}
        errorProviders={errorProviders}
        mistFeedErrorProviders={mistFeedErrorProviders}
        selectedProvider={selectedProvider}
        onSelectProvider={handleSelectProvider}
        onShowOverview={handleShowOverview}
        onProviderButtonRef={handleProviderButtonRef}
      />

      <StatusBar
        left={<StatusBarLive />}
        center={<span>{updatedLabel}</span>}
        right={
          <span className="cloud-status__status-summary">
            {DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length} providers monitored · {statusBarSummary}
          </span>
        }
      />
    </div>
  );
};
