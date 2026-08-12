import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downdetectorUrl, type CloudStatusData } from '@shared/ipc';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { TactileButton } from '../components/TactileButton';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { CURRENT_CLOUD_OUTAGE_WINDOW_MS, isCurrentCloudIssue } from '../utils/cloudStatus';
import {
  aggregateCloudStatusForDisplay,
  DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
  DISPLAY_CLOUD_STATUS_PROVIDERS,
  type DisplayCloudStatusItem,
  type DisplayCloudStatusProvider,
} from '../utils/cloudStatusDisplay';

type ProviderPosture = 'outage' | 'degraded' | 'unknown' | 'clear';
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
  if (hasDegradation) return 'degraded';
  if (hasFeedError) return 'unknown';
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
  if (posture === 'degraded') return 1;
  if (posture === 'unknown') return 2;
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
  return (
    <div className="cloud-status-provider__actions">
      <button
        type="button"
        onClick={() => void globalThis.api?.openExternal(config.statusUrl)}
        aria-label={`Open ${providerLabel(provider)} official status page`}
      >
        Status
      </button>
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
        View official status{' ' /* Keep text separate from the decorative glyph. */}
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
  if (degradedCount > 0) {
    return { tone: 'degraded', label: degradedCountLabel(degradedCount) };
  }
  if (hasFeedErrors) return { tone: 'unknown', label: 'Coverage incomplete' };
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
    <section className="cloud-status__providers-panel" aria-label="Provider overview">
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
  </div>
);

const ProviderDetailWorkspace: React.FC<ProviderDetailWorkspaceProps> = ({
  issues,
  outageProviders,
  degradedProviders,
  errorProviders,
  selectedProvider,
  onShowOverview,
}) => {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selectedProvider) backButtonRef.current?.focus();
  }, [selectedProvider]);

  if (!selectedProvider) return null;

  const selectedIssues = issues.filter((item) => item.provider === selectedProvider);
  const posture = providerPosture(
    outageProviders.has(selectedProvider),
    degradedProviders.has(selectedProvider),
    errorProviders.has(selectedProvider),
  );
  const label = providerLabel(selectedProvider);
  const unavailable = posture === 'unknown';

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
            </div>
          </div>
          <span className={`cloud-status-provider__state cloud-status-provider__state--${posture}`}>
            {postureLabel(posture)}
          </span>
          <ProviderActions provider={selectedProvider} />
        </div>

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
                ? `Status feed unavailable for ${label}`
                : `No active issues for ${label}`}
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
    return <ProviderDetailWorkspace {...props} />;
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
  const degradedCount = issues.length - outageCount;
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
    () =>
      new Set(issues.filter((item) => item.severity === 'warning').map((item) => item.provider)),
    [issues],
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
            {DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length} providers monitored ·{' '}
            {snapshotUnavailable
              ? 'coverage unavailable'
              : activeIssueCountLabel(outageCount, degradedCount)}
          </span>
        }
      />
    </div>
  );
};
