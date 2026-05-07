import React, { useState, useMemo } from 'react';
import { TabFallback } from '../components/TabFallback';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { Tooltip } from '../components/Tooltip';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import {
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';

type FilterMode = 'all' | CloudStatusProvider;
type FeedMode = 'active' | 'recent' | 'resolved';

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function lastUpdatedLabel(ts: number): string {
  if (!ts) return 'Never';
  return timeAgo(new Date(ts).toISOString());
}

function severityLabel(severity: CloudStatusSeverity): string {
  switch (severity) {
    case 'error':
      return 'OUTAGE';
    case 'warning':
      return 'DEGRADED';
    case 'resolved':
      return 'RESOLVED';
    case 'info':
      return 'INFO';
  }
}

function providerLabel(provider: CloudStatusProvider): string {
  return CLOUD_STATUS_PROVIDERS[provider]?.label ?? provider;
}

function providerShortLabel(provider: CloudStatusProvider): string {
  const cfg = CLOUD_STATUS_PROVIDERS[provider];
  return cfg?.shortLabel ?? cfg?.label ?? provider;
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
  // First pass: decode HTML entities (handles double-encoded content like &lt;div&gt;)
  const decoded = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  // Second pass: strip any actual HTML tags from the decoded content
  return new DOMParser().parseFromString(decoded, 'text/html').body.textContent ?? '';
}

function isActiveIssue(item: CloudStatusItem): boolean {
  return item.severity === 'error' || item.severity === 'warning';
}

function issueCountLabel(count: number): string {
  return `${count} active ${count === 1 ? 'issue' : 'issues'}`;
}

function getProviderStats(items: CloudStatusItem[], hasError: boolean) {
  const outages = items.filter((item) => item.severity === 'error').length;
  const degraded = items.filter((item) => item.severity === 'warning').length;
  const activeIssues = outages + degraded;
  const isImpacted = hasError || activeIssues > 0;
  return { outages, degraded, activeIssues, isImpacted };
}

function getWorstSeverityLabel(items: CloudStatusItem[], hasFeedErrors: boolean): string {
  if (items.some((item) => item.severity === 'error')) return 'Outage';
  if (items.some((item) => item.severity === 'warning')) return 'Degraded';
  if (hasFeedErrors) return 'Unknown';
  return 'Normal';
}

function sortProvidersByPosture(
  providers: readonly CloudStatusProvider[],
  statusData: CloudStatusData | null,
  errorProviders: ReadonlySet<CloudStatusProvider>,
): CloudStatusProvider[] {
  return [...providers].sort((a, b) => {
    const aStats = getProviderStats(statusData?.providers[a] ?? [], errorProviders.has(a));
    const bStats = getProviderStats(statusData?.providers[b] ?? [], errorProviders.has(b));
    if (aStats.isImpacted !== bStats.isImpacted) return aStats.isImpacted ? -1 : 1;
    if (aStats.outages !== bStats.outages) return bStats.outages - aStats.outages;
    if (aStats.degraded !== bStats.degraded) return bStats.degraded - aStats.degraded;
    return providers.indexOf(a) - providers.indexOf(b);
  });
}

// --- Subcomponents ---

const ProviderCard: React.FC<{
  provider: CloudStatusProvider;
  items: CloudStatusItem[];
  hasError: boolean;
}> = ({ provider, items, hasError }) => {
  const stats = getProviderStats(items, hasError);
  const isOk = stats.activeIssues === 0 && !hasError;

  const getIndicatorVariant = (): string => {
    if (hasError) return 'unknown';
    if (isOk) return 'ok';
    if (stats.outages > 0) return 'error';
    return 'warning';
  };

  const renderStatus = () => {
    if (hasError) {
      return (
        <span className="cloud-status-provider__status cloud-status-provider__status--unknown">
          Feed unavailable
        </span>
      );
    }
    if (isOk) {
      return (
        <span className="cloud-status-provider__status cloud-status-provider__status--ok">
          All services normal
        </span>
      );
    }
    return (
      <span className="cloud-status-provider__status cloud-status-provider__status--issue">
        {issueCountLabel(stats.activeIssues)}
      </span>
    );
  };

  return (
    <button
      type="button"
      className={`cloud-status-provider cloud-status-provider--${provider}${
        stats.isImpacted ? ' cloud-status-provider--impacted' : ''
      }${stats.outages > 0 ? ' cloud-status-provider--outage' : ''}`}
      onClick={() => void globalThis.api?.openExternal(CLOUD_STATUS_PROVIDERS[provider].statusUrl)}
    >
      <div className="cloud-status-provider__header">
        <span className="cloud-status-provider__name">
          <span className="cloud-status-provider__icon">
            <ProviderIcon provider={provider} size={16} />
          </span>
          {providerLabel(provider)}
        </span>
        <span
          className={`cloud-status-provider__indicator cloud-status-provider__indicator--${getIndicatorVariant()}`}
        />
      </div>
      <div className="cloud-status-provider__body">
        {renderStatus()}
        {!hasError && !isOk && (
          <span className="cloud-status-provider__counts">
            {stats.outages > 0 && (
              <span className="cloud-status-provider__count cloud-status-provider__count--error">
                Outage {stats.outages}
              </span>
            )}
            {stats.degraded > 0 && (
              <span className="cloud-status-provider__count cloud-status-provider__count--warning">
                Degraded {stats.degraded}
              </span>
            )}
          </span>
        )}
      </div>
    </button>
  );
};

const StatusItemCard: React.FC<{
  item: CloudStatusItem;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ item, isExpanded, onToggle }) => {
  const cleanDescription = useMemo(() => stripHtml(item.description), [item.description]);

  return (
    <div
      className={`cloud-status-item cloud-status-item--${item.severity}${
        isExpanded ? ' cloud-status-item--expanded' : ''
      }`}
    >
      <button
        type="button"
        className="cloud-status-item__header"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <span
          className={`cloud-status-item__severity cloud-status-item__severity--${item.severity}`}
        >
          {severityLabel(item.severity)}
        </span>
        <span className="cloud-status-item__provider-tag">{providerLabel(item.provider)}</span>
        <span className="cloud-status-item__title">{item.title}</span>
        <span className="cloud-status-item__time">{formatLocalTime(item.pubDate)}</span>
        <svg
          className={`cloud-status-item__chevron ${isExpanded ? 'cloud-status-item__chevron--open' : ''}`}
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isExpanded && (
        <div className="cloud-status-item__body">
          <p className="cloud-status-item__description">{cleanDescription}</p>
          <button
            type="button"
            className="cloud-status-item__link"
            onClick={() =>
              void globalThis.api?.openExternal(
                item.link || CLOUD_STATUS_PROVIDERS[item.provider].statusUrl,
              )
            }
          >
            View details
          </button>
        </div>
      )}
    </div>
  );
};

// --- Main Tab ---

export const CloudStatusTab: React.FC<{
  statusData: CloudStatusData | null;
  loading: boolean;
  refetch: () => void;
}> = ({ statusData, loading, refetch }) => {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [feedMode, setFeedMode] = useState<FeedMode>('active');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const errorProviders = useMemo(
    () => new Set(statusData?.errors.map((e) => e.provider) ?? []),
    [statusData?.errors],
  );

  const allItems = useMemo(() => {
    if (!statusData) return [];
    return Object.values(statusData.providers).flat();
  }, [statusData]);

  const posture = useMemo(() => {
    const activeIssues = allItems.filter(isActiveIssue);
    const impactedProviders = sortProvidersByPosture(
      CLOUD_STATUS_PROVIDER_ORDER,
      statusData,
      errorProviders,
    ).filter((provider) => {
      const stats = getProviderStats(
        statusData?.providers[provider] ?? [],
        errorProviders.has(provider),
      );
      return stats.isImpacted;
    });
    return {
      activeIssues,
      impactedProviders,
      worstSeverity: getWorstSeverityLabel(allItems, errorProviders.size > 0),
      quietProviderCount: Math.max(
        0,
        CLOUD_STATUS_PROVIDER_ORDER.length - impactedProviders.length,
      ),
    };
  }, [allItems, errorProviders, statusData]);

  const providerOrder = useMemo(
    () => sortProvidersByPosture(CLOUD_STATUS_PROVIDER_ORDER, statusData, errorProviders),
    [errorProviders, statusData],
  );

  const items = useMemo(() => {
    const filteredByProvider =
      filter === 'all' ? allItems : allItems.filter((item) => item.provider === filter);
    const filteredByMode = filteredByProvider.filter((item) => {
      if (feedMode === 'active') return isActiveIssue(item);
      if (feedMode === 'resolved') return item.severity === 'resolved';
      return item.severity !== 'resolved';
    });
    return [...filteredByMode].sort(
      (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
    );
  }, [allItems, feedMode, filter]);

  if (!statusData && loading) return <TabFallback />;

  return (
    <div className="cloud-status">
      <div className="cloud-status__header">
        <div>
          <div className="cloud-status__eyebrow">Service Status</div>
          <h2 className="cloud-status__title">Command Center</h2>
        </div>
        <div className="cloud-status__meta">
          <span className="cloud-status__updated">
            Updated {lastUpdatedLabel(statusData?.lastUpdated ?? 0)}
          </span>
          <Tooltip content={loading ? 'Refreshing cloud status' : 'Refresh cloud status'}>
            <button
              type="button"
              className="cloud-status__refresh"
              onClick={refetch}
              disabled={loading}
              aria-label="Refresh cloud status"
            >
              <svg
                className={loading ? 'cloud-status__refresh-icon--spinning' : ''}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="cloud-status__filters" aria-label="Provider filters">
        <button
          type="button"
          className={`cloud-status__filter ${filter === 'all' ? 'cloud-status__filter--active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        {CLOUD_STATUS_PROVIDER_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            className={`cloud-status__filter ${filter === p ? 'cloud-status__filter--active' : ''}`}
            onClick={() => setFilter(p)}
          >
            <ProviderIcon provider={p} size={14} />
            {providerShortLabel(p)}
          </button>
        ))}
      </div>

      <div className="cloud-status__posture">
        <section className="cloud-status-posture-card cloud-status-posture-card--primary">
          <span className="cloud-status-posture-card__label">Current posture</span>
          <strong>{issueCountLabel(posture.activeIssues.length)}</strong>
          <span className="cloud-status-posture-card__sub">
            {posture.impactedProviders.length > 0
              ? `${posture.impactedProviders.map(providerShortLabel).slice(0, 3).join(', ')} need attention first.`
              : 'No providers currently need attention.'}
          </span>
        </section>
        <section className="cloud-status-posture-card">
          <span className="cloud-status-posture-card__label">Impacted providers</span>
          <strong>
            {posture.impactedProviders.length} impacted{' '}
            {posture.impactedProviders.length === 1 ? 'provider' : 'providers'}
          </strong>
          <span className="cloud-status-posture-card__sub">
            of {CLOUD_STATUS_PROVIDER_ORDER.length} monitored
          </span>
        </section>
        <section className="cloud-status-posture-card">
          <span className="cloud-status-posture-card__label">Worst severity</span>
          <strong>{posture.worstSeverity}</strong>
          <span className="cloud-status-posture-card__sub">highest current signal</span>
        </section>
        <section className="cloud-status-posture-card">
          <span className="cloud-status-posture-card__label">Quiet providers</span>
          <strong>{posture.quietProviderCount}</strong>
          <span className="cloud-status-posture-card__sub">normal or informational only</span>
        </section>
      </div>

      <div className="cloud-status__workspace">
        <section className="cloud-status__providers-panel">
          <div className="cloud-status__section-title">
            <span>Provider posture</span>
            <span>Impacted first</span>
          </div>
          <div className="cloud-status__summary">
            {providerOrder.map((p) => (
              <ProviderCard
                key={p}
                provider={p}
                items={statusData?.providers[p] ?? []}
                hasError={errorProviders.has(p)}
              />
            ))}
          </div>
        </section>

        <section className="cloud-status__feed">
          <div className="cloud-status__feed-header">
            <div className="cloud-status__section-title">Incident feed</div>
            <div className="cloud-status__feed-toggle" aria-label="Incident feed filters">
              {(['active', 'recent', 'resolved'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`cloud-status__feed-toggle-btn ${
                    feedMode === mode ? 'cloud-status__feed-toggle-btn--active' : ''
                  }`}
                  onClick={() => setFeedMode(mode)}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {items.length === 0 ? (
            <div className="cloud-status__empty">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.4"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>No recent events — all clear</span>
            </div>
          ) : (
            <div className="cloud-status__feed-list">
              {items.map((item) => (
                <StatusItemCard
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  onToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <details className="cloud-status__footer">
        <summary>Socials</summary>
        <div className="cloud-status__footer-body">
          <span className="cloud-status__footer-links">
            𝕏{' '}
            {CLOUD_STATUS_PROVIDER_ORDER.filter((p) => CLOUD_STATUS_PROVIDERS[p].twitterHandle).map(
              (p, i) => (
                <React.Fragment key={p}>
                  {i > 0 && ' · '}
                  <button
                    type="button"
                    className="cloud-status__ext-link"
                    onClick={() =>
                      void globalThis.api?.openExternal(
                        `https://x.com/${CLOUD_STATUS_PROVIDERS[p].twitterHandle}`,
                      )
                    }
                  >
                    @{CLOUD_STATUS_PROVIDERS[p].twitterHandle}
                  </button>
                </React.Fragment>
              ),
            )}
          </span>
        </div>
      </details>

      <StatusBar
        left={<StatusBarLive />}
        right={<span>{CLOUD_STATUS_PROVIDER_ORDER.length} providers monitored</span>}
      />
    </div>
  );
};
