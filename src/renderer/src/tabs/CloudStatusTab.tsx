import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downdetectorUrl, type CloudStatusData, type MistCloudStatusProvider } from '@shared/ipc';
import { STALE_CLOUD_STATUS_AFTER_MS } from '@shared/cloudStatus';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import { EmptyState } from '../components/EmptyState';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { TabFreshness } from '../components/TabFreshness';
import { TactileButton } from '../components/TactileButton';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { CURRENT_CLOUD_OUTAGE_WINDOW_MS, isCurrentCloudIssue } from '../utils/cloudStatus';
import {
  aggregateCloudStatusForDisplay,
  DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
  DISPLAY_CLOUD_STATUS_PROVIDERS,
  DISPLAY_MIST_REGION_OPTIONS,
  type DisplayCloudStatusItem,
  type DisplayCloudStatusProvider,
} from '../utils/cloudStatusDisplay';

type ProviderPosture = 'outage' | 'degraded' | 'unknown' | 'clear';
type MistRegionFilter = 'all' | MistCloudStatusProvider;
const MAX_TIMEOUT_MS = 2_147_483_647;
/** Matches the wide provider grid in cloud-status.css: room to show every provider without a toggle. */
const ROOMY_VIEWPORT_QUERY = '(min-width: 1600px) and (min-height: 1000px)';

function viewportHasRoomForAllProviders(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia(ROOMY_VIEWPORT_QUERY).matches === true
  );
}

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
          Official Support
        </button>
      )}
      {config.twitterHandle && (
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(`https://x.com/${config.twitterHandle}`)}
          aria-label={`@${config.twitterHandle}, Open ${providerLabel(provider)} on X`}
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
        {sourceLabel ? `View ${sourceLabel} Report` : 'View Official Status'}{' '}
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
    width="24"
    height="24"
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

type FeedUnavailableNoticeProps = Readonly<{
  feedErrors: readonly { provider: DisplayCloudStatusProvider; message: string }[];
  snapshotUnavailable: boolean;
  lastUpdated: number;
}>;

/**
 * The page's failure state, in Radar's pattern: what failed and why, the age of what is shown,
 * how it recovers on its own, a pointer to the command bar's Refresh, and the raw feed errors
 * behind Technical details. Neutral, not an alarm: a failed feed leaves those providers unknown.
 */
const FeedUnavailableNotice: React.FC<FeedUnavailableNoticeProps> = ({
  feedErrors,
  snapshotUnavailable,
  lastUpdated,
}) => {
  if (!snapshotUnavailable && feedErrors.length === 0) return null;
  const failedNames = [...new Set(feedErrors.map((error) => providerLabel(error.provider)))];
  const single = failedNames.length === 1;
  let title = 'Provider status unavailable';
  let cause =
    'This workstation has no provider snapshot from the Relay server yet, so every provider reads Unknown.';
  if (!snapshotUnavailable) {
    title = `${failedNames.length} provider ${single ? 'feed' : 'feeds'} unavailable`;
    cause = `Relay could not read ${failedNames.join(', ')}. ${single ? 'Its row reads' : 'Their rows read'} Unknown; other providers are current.`;
  }
  const age = lastUpdated > 0 ? `Last successful update ${lastUpdatedLabel(lastUpdated)}. ` : '';
  return (
    <section className="cloud-status__notice" aria-labelledby="cloud-status-feed-problem-title">
      {/* Not a live region: it mounts with its text, which is often not read. The always-mounted
          summary status above announces the change in coverage. */}
      <div>
        <strong id="cloud-status-feed-problem-title" className="cloud-status__notice-title">
          {title}
        </strong>
        <p>{cause}</p>
        <p className="cloud-status__notice-meta">
          {age}This page updates on its own when the Relay server&apos;s next check arrives. Use
          Refresh above to check now.
        </p>
      </div>
      {feedErrors.length > 0 && (
        <details className="cloud-status__notice-details">
          <summary>Technical details</summary>
          <code>
            {feedErrors
              .map((error) => `${providerLabel(error.provider)}: ${error.message}`)
              .join('\n')}
          </code>
        </details>
      )}
    </section>
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
  operationalExpanded: boolean;
  onToggleOperational: () => void;
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
  operationalExpanded,
  onToggleOperational,
  onSelectProvider,
  onProviderButtonRef,
}) => {
  // Healthy providers collapse into one summary line so outages and degradations stay prominent.
  const attentionProviders = providerOrder.filter(
    (provider) =>
      outageProviders.has(provider) ||
      degradedProviders.has(provider) ||
      errorProviders.has(provider),
  );
  const operationalProviders = providerOrder.filter(
    (provider) => !attentionProviders.includes(provider),
  );
  const renderRow = (provider: DisplayCloudStatusProvider) => (
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
  );
  const operationalLabel = `${operationalProviders.length} ${
    operationalProviders.length === 1 ? 'provider' : 'providers'
  } operational`;

  return (
    <div className="cloud-status__workspace cloud-status__workspace--overview">
      <div className="cloud-status__providers-panel">
        <section className="cloud-status__monitored-providers" aria-label="Provider overview">
          <div className="cloud-status__section-heading">
            <span>Provider overview</span>
          </div>
          {attentionProviders.length > 0 && (
            <div className="cloud-status__provider-list">{attentionProviders.map(renderRow)}</div>
          )}
          {operationalProviders.length > 0 && (
            <div className="cloud-status__operational">
              <button
                type="button"
                className="cloud-status__operational-toggle"
                aria-expanded={operationalExpanded}
                aria-controls="cloud-status-operational-providers"
                onClick={onToggleOperational}
              >
                <span
                  className="cloud-status-provider__signal cloud-status-provider__signal--clear"
                  aria-hidden="true"
                />
                <span className="cloud-status__operational-label">{operationalLabel}</span>
                <span className="cloud-status__operational-action">
                  {operationalExpanded ? 'Hide' : 'Show'}
                </span>
                <span className="cloud-status__operational-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              {operationalExpanded && (
                <div
                  id="cloud-status-operational-providers"
                  className="cloud-status__provider-list"
                >
                  {operationalProviders.map(renderRow)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

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
            All Providers
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
          <EmptyState
            titleAs="h3"
            glyph={<CoverageStateIcon unknown={unavailable} />}
            title={
              unavailable
                ? `Status feed unavailable for ${detailLabel}`
                : `No active issues for ${detailLabel}`
            }
            description={
              unavailable
                ? 'Use the provider links above to verify its current public status.'
                : 'Relay will surface new outages and degradations here when they are reported.'
            }
          />
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
  useEffect(() => {
    const intervalId = window.setInterval(() => setIssueEvaluationTime(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);
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
  const [roomyViewport] = useState(viewportHasRoomForAllProviders);
  // null follows the default; a Show/Hide choice sticks until the tab remounts.
  const [operationalOverride, setOperationalOverride] = useState<boolean | null>(null);
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
  // Every provider is listed on a roomy screen only while all are healthy: during an incident the
  // operational ones fold into one "N providers operational" row so affected rows lead.
  const anyProviderAffected =
    outageProviders.size > 0 || degradedProviders.size > 0 || errorProviders.size > 0;
  const operationalExpanded = operationalOverride ?? (roomyViewport && !anyProviderAffected);
  const handleToggleOperational = useCallback(
    () => setOperationalOverride(!operationalExpanded),
    [operationalExpanded],
  );
  const handleShowOverview = useCallback(() => {
    focusReturnProviderRef.current = selectedProvider;
    // A healthy provider's row lives in the collapsed group; reveal it so focus can return there.
    if (
      selectedProvider &&
      !outageProviders.has(selectedProvider) &&
      !degradedProviders.has(selectedProvider) &&
      !errorProviders.has(selectedProvider)
    ) {
      setOperationalOverride(true);
    }
    if (controlledSelectedProvider === undefined) setInternalSelectedProvider(null);
    onSelectedProviderChange?.(null);
  }, [
    controlledSelectedProvider,
    degradedProviders,
    errorProviders,
    onSelectedProviderChange,
    outageProviders,
    selectedProvider,
  ]);

  if (!statusData && loading) return <TabFallback />;

  const snapshotUnavailable = statusData === null;
  const hasFeedErrors = errorProviders.size > 0;
  const lastUpdated = statusData?.lastUpdated ?? 0;
  // The Relay server refreshes every 5 minutes at most; past two missed refreshes the readout
  // warns that the snapshot is old rather than letting an old clock time read as quiet.
  const updatedStale =
    lastUpdated > 0 && issueEvaluationTime - lastUpdated > STALE_CLOUD_STATUS_AFTER_MS;
  const summary = statusSummary(outageCount, degradedCount, hasFeedErrors, snapshotUnavailable);
  const refreshText = loading ? 'Refreshing…' : 'Refresh';

  return (
    <div className="cloud-status">
      <TabPageHeader
        title="Status"
        subtitle="External providers"
        metadata={
          <>
            {/* The page's status readout, in the header slot Radar uses for its status word. The
                pip shapes are the tab's legend; Help defines each one beside the summary pip. */}
            <span
              className={`cloud-status__summary cloud-status__summary--${summary.tone}`}
              role="status"
            >
              <span className="cloud-status__summary-signal" aria-hidden="true" />
              <strong>{summary.label}</strong>
              <span>across {DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length} monitored providers</span>
            </span>
          </>
        }
      />

      <TabCommandBar ariaLabel="Status actions">
        <TabCommandGroup kind="utility">
          <TactileButton
            variant="secondary"
            className="cloud-status__refresh"
            onClick={refetch}
            disabled={loading}
            // The visible word leads the name, so "Refreshing…" stays in it while busy.
            aria-label={`${refreshText} cloud status`}
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
          >
            {refreshText}
          </TactileButton>
          {/* Freshness sits directly after the Refresh that changes it, on every live-data page. */}
          <TabFreshness at={lastUpdated} stale={updatedStale} />
        </TabCommandGroup>
      </TabCommandBar>
      {/* Polls change the clock time silently; only the move to and from stale is announced. */}
      <output className="sr-only">{updatedStale ? 'Cloud status may be stale' : ''}</output>

      <FeedUnavailableNotice
        feedErrors={displayStatus?.errors ?? []}
        snapshotUnavailable={snapshotUnavailable}
        lastUpdated={lastUpdated}
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
        operationalExpanded={operationalExpanded}
        onToggleOperational={handleToggleOperational}
        onShowOverview={handleShowOverview}
        onProviderButtonRef={handleProviderButtonRef}
      />

      {/* The header states the counts and the command bar the freshness, so the status bar
        carries only the shared connection state. */}
      <StatusBar left={<StatusBarLive />} />
    </div>
  );
};
