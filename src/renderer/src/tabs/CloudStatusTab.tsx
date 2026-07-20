import React, { useMemo, useState } from 'react';
import {
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  downdetectorUrl,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { Tooltip } from '../components/Tooltip';
import { SearchInput } from '../components/SearchInput';

type FilterMode = 'all' | CloudStatusProvider;
type FeedMode = 'active' | 'recent' | 'resolved';

const FEED_FILTERS: Array<{ id: FeedMode; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'recent', label: 'Recent' },
  { id: 'resolved', label: 'Resolved' },
];

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

function isActiveIssue(item: CloudStatusItem): boolean {
  return item.severity === 'error' || item.severity === 'warning';
}

function matchesFeedMode(item: CloudStatusItem, mode: FeedMode): boolean {
  if (mode === 'active') return isActiveIssue(item);
  if (mode === 'resolved') return item.severity === 'resolved';
  return item.severity !== 'resolved';
}

function issueCountLabel(count: number): string {
  return `${count} active ${count === 1 ? 'issue' : 'issues'}`;
}

function getProviderStats(items: CloudStatusItem[], hasError: boolean) {
  const outages = items.filter((item) => item.severity === 'error').length;
  const degraded = items.filter((item) => item.severity === 'warning').length;
  const activeIssues = outages + degraded;
  return {
    outages,
    degraded,
    activeIssues,
    isImpacted: hasError || activeIssues > 0,
  };
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

function providerTone(items: CloudStatusItem[], hasError: boolean) {
  if (hasError) return 'unknown';
  if (items.some((item) => item.severity === 'error')) return 'error';
  if (items.some((item) => item.severity === 'warning')) return 'warning';
  return 'ok';
}

function providerStatusLabel(items: CloudStatusItem[], hasError: boolean): string {
  if (hasError) return 'Feed unavailable';
  const stats = getProviderStats(items, false);
  if (stats.activeIssues === 0) return 'All services normal';
  return issueCountLabel(stats.activeIssues);
}

function providerToneLabel(tone: ReturnType<typeof providerTone>): string {
  if (tone === 'ok') return 'Normal';
  if (tone === 'unknown') return 'Unknown';
  if (tone === 'error') return 'Outage';
  return 'Degraded';
}

const ProviderRow: React.FC<{
  provider: CloudStatusProvider;
  items: CloudStatusItem[];
  hasError: boolean;
  selected: boolean;
  onSelect: () => void;
}> = ({ provider, items, hasError, selected, onSelect }) => {
  const stats = getProviderStats(items, hasError);
  const tone = providerTone(items, hasError);
  const { twitterHandle, downdetectorSlug, statusUrl } = CLOUD_STATUS_PROVIDERS[provider];

  return (
    <article
      className={`cloud-status-provider${selected ? ' cloud-status-provider--selected' : ''}`}
    >
      <button
        type="button"
        className="cloud-status-provider__main"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Show ${providerLabel(provider)} incidents`}
      >
        <span className={`cloud-status-provider__signal cloud-status-provider__signal--${tone}`} />
        <span className="cloud-status-provider__content">
          <span className="cloud-status-provider__header">
            <span className="cloud-status-provider__name">
              <ProviderIcon provider={provider} size={16} />
              {providerLabel(provider)}
            </span>
            <span className={`cloud-status-badge cloud-status-badge--${tone}`}>
              {providerToneLabel(tone)}
            </span>
          </span>
          <span className="cloud-status-provider__body">
            <span
              className={`cloud-status-provider__status cloud-status-provider__status--${tone}`}
            >
              {providerStatusLabel(items, hasError)}
            </span>
            {stats.activeIssues > 0 && (
              <span className="cloud-status-provider__counts">
                {stats.outages > 0 && <span>Outage {stats.outages}</span>}
                {stats.degraded > 0 && <span>Degraded {stats.degraded}</span>}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="cloud-status-provider__links">
        <button
          type="button"
          onClick={() => void globalThis.api?.openExternal(statusUrl)}
          aria-label={`Open ${providerLabel(provider)} status page`}
        >
          Status page ↗
        </button>
        {twitterHandle && (
          <button
            type="button"
            onClick={() => void globalThis.api?.openExternal(`https://x.com/${twitterHandle}`)}
          >
            @{twitterHandle}
          </button>
        )}
        {downdetectorSlug && (
          <button
            type="button"
            onClick={() => void globalThis.api?.openExternal(downdetectorUrl(downdetectorSlug))}
          >
            Downdetector ↗
          </button>
        )}
      </div>
    </article>
  );
};

const StatusItemRow: React.FC<{
  item: CloudStatusItem;
  expanded: boolean;
  onToggle: () => void;
}> = ({ item, expanded, onToggle }) => {
  const description = useMemo(() => stripHtml(item.description), [item.description]);

  return (
    <article
      className={`cloud-status-item cloud-status-item--${item.severity}${
        expanded ? ' cloud-status-item--expanded' : ''
      }`}
    >
      <button
        type="button"
        className="cloud-status-item__header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`cloud-status-item__signal cloud-status-item__signal--${item.severity}`} />
        <span className="cloud-status-item__content">
          <span className="cloud-status-item__topline">
            <span
              className={`cloud-status-item__severity cloud-status-item__severity--${item.severity}`}
            >
              {severityLabel(item.severity)}
            </span>
            <span className="cloud-status-item__provider-tag">{providerLabel(item.provider)}</span>
            <span className="cloud-status-item__time">{formatLocalTime(item.pubDate)}</span>
          </span>
          <span className="cloud-status-item__title">{item.title}</span>
        </span>
        <svg
          className={`cloud-status-item__chevron${expanded ? ' cloud-status-item__chevron--open' : ''}`}
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
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="cloud-status-item__body">
          <p>{description || 'No additional details were published.'}</p>
          <button
            type="button"
            onClick={() =>
              void globalThis.api?.openExternal(
                item.link || CLOUD_STATUS_PROVIDERS[item.provider].statusUrl,
              )
            }
          >
            View source ↗
          </button>
        </div>
      )}
    </article>
  );
};

function emptyFeedCopy(mode: FeedMode, hasQuery: boolean): { title: string; detail: string } {
  if (hasQuery) {
    return {
      title: 'No matching incidents',
      detail: 'Clear the search or choose another provider.',
    };
  }
  if (mode === 'resolved') {
    return {
      title: 'No resolved incidents in the current feed',
      detail: 'Resolved vendor updates will appear here when published.',
    };
  }
  if (mode === 'recent') {
    return { title: 'No recent provider updates', detail: 'The monitored feeds are quiet.' };
  }
  return { title: 'No active provider incidents', detail: 'All monitored providers are clear.' };
}

export const CloudStatusTab: React.FC<{
  statusData: CloudStatusData | null;
  loading: boolean;
  refetch: () => void;
}> = ({ statusData, loading, refetch }) => {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [feedMode, setFeedMode] = useState<FeedMode>('active');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const errorProviders = useMemo(
    () => new Set(statusData?.errors.map((error) => error.provider) ?? []),
    [statusData?.errors],
  );
  const allItems = useMemo(
    () => (statusData ? Object.values(statusData.providers).flat() : []),
    [statusData],
  );
  const counts = useMemo(
    () => ({
      active: allItems.filter(isActiveIssue).length,
      recent: allItems.filter((item) => item.severity !== 'resolved').length,
      resolved: allItems.filter((item) => item.severity === 'resolved').length,
    }),
    [allItems],
  );
  const providerOrder = useMemo(
    () => sortProvidersByPosture(CLOUD_STATUS_PROVIDER_ORDER, statusData, errorProviders),
    [errorProviders, statusData],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleProviders = useMemo(
    () =>
      providerOrder.filter((provider) => {
        if (!normalizedQuery) return true;
        const providerItems = statusData?.providers[provider] ?? [];
        return (
          providerLabel(provider).toLowerCase().includes(normalizedQuery) ||
          providerItems.some((item) =>
            `${item.title} ${item.description}`.toLowerCase().includes(normalizedQuery),
          )
        );
      }),
    [normalizedQuery, providerOrder, statusData?.providers],
  );
  const items = useMemo(
    () =>
      allItems
        .filter((item) => filter === 'all' || item.provider === filter)
        .filter((item) => matchesFeedMode(item, feedMode))
        .filter(
          (item) =>
            !normalizedQuery ||
            `${providerLabel(item.provider)} ${item.title} ${item.description}`
              .toLowerCase()
              .includes(normalizedQuery),
        )
        .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()),
    [allItems, feedMode, filter, normalizedQuery],
  );

  if (!statusData && loading) return <TabFallback />;

  const updatedLabel = `Updated ${lastUpdatedLabel(statusData?.lastUpdated ?? 0)}`;
  const emptyCopy = emptyFeedCopy(feedMode, Boolean(normalizedQuery));

  return (
    <div className="cloud-status">
      <div className="cloud-status__header">
        <div>
          <div className="cloud-status__context">Service Status</div>
          <h2 className="cloud-status__title">External service monitor</h2>
        </div>
        <div className="cloud-status__meta">
          <span>{updatedLabel}</span>
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
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="cloud-status__toolbar">
        <div className="cloud-status__filters" role="tablist" aria-label="Incident feed filters">
          {FEED_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={feedMode === item.id}
              className={`cloud-status__filter${
                feedMode === item.id ? ' cloud-status__filter--active' : ''
              }`}
              onClick={() => setFeedMode(item.id)}
            >
              <span>{item.label}</span>
              <span className="cloud-status__filter-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="cloud-status__search scoped-search-control">
          <SearchInput
            type="search"
            aria-label="Search service status"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search provider or incident"
            className="scoped-search-input"
          />
        </div>
      </div>

      {statusData && statusData.errors.length > 0 && (
        <div className="cloud-status__notice" role="status">
          <strong>Some provider feeds are unavailable.</strong>
          <span>Last known data is shown where Relay has it.</span>
        </div>
      )}

      <div className="cloud-status__workspace">
        <section className="cloud-status__providers-panel" aria-label="Provider posture">
          <div className="cloud-status__section-heading">
            <span>Provider posture</span>
            {filter === 'all' ? (
              <span>{visibleProviders.length} monitored</span>
            ) : (
              <button type="button" onClick={() => setFilter('all')}>
                Clear provider
              </button>
            )}
          </div>
          <div className="cloud-status__summary">
            {visibleProviders.length === 0 ? (
              <div className="cloud-status__empty cloud-status__empty--compact">
                <strong>No matching providers</strong>
                <span>Clear the search to restore the provider queue.</span>
              </div>
            ) : (
              visibleProviders.map((provider) => (
                <ProviderRow
                  key={provider}
                  provider={provider}
                  items={statusData?.providers[provider] ?? []}
                  hasError={errorProviders.has(provider)}
                  selected={filter === provider}
                  onSelect={() => setFilter((current) => (current === provider ? 'all' : provider))}
                />
              ))
            )}
          </div>
        </section>

        <section className="cloud-status__feed" aria-label="Service incident feed">
          <div className="cloud-status__section-heading">
            <span>{filter === 'all' ? 'Incident feed' : `${providerLabel(filter)} incidents`}</span>
            <span>{items.length} shown</span>
          </div>
          {items.length === 0 ? (
            <div className="cloud-status__empty">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <strong>{emptyCopy.title}</strong>
              <span>{emptyCopy.detail}</span>
            </div>
          ) : (
            <div className="cloud-status__feed-list">
              {items.map((item) => (
                <StatusItemRow
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() =>
                    setExpandedId((current) => (current === item.id ? null : item.id))
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <StatusBar
        left={<StatusBarLive />}
        center={<span>{updatedLabel}</span>}
        right={
          <span className="cloud-status__status-summary">
            <span>{CLOUD_STATUS_PROVIDER_ORDER.length} providers monitored</span>
            <span> · {issueCountLabel(counts.active)}</span>
          </span>
        }
      />
    </div>
  );
};
