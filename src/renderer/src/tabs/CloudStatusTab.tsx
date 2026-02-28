import React, { useState, useMemo } from 'react';
import { TabFallback } from '../components/TabFallback';
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

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
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
  if (isNaN(date.getTime())) return '';
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

// --- Subcomponents ---

const ProviderCard: React.FC<{
  provider: CloudStatusProvider;
  items: CloudStatusItem[];
  hasError: boolean;
}> = ({ provider, items, hasError }) => {
  const activeIssues = items.filter((i) => i.severity === 'error' || i.severity === 'warning');
  const isOk = activeIssues.length === 0 && !hasError;
  const hasOutage = activeIssues.some((i) => i.severity === 'error');

  const getIndicatorVariant = (): string => {
    if (hasError) return 'unknown';
    if (isOk) return 'ok';
    if (hasOutage) return 'error';
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
        {activeIssues.length} active {activeIssues.length === 1 ? 'issue' : 'issues'}
      </span>
    );
  };

  return (
    <button
      type="button"
      className={`cloud-status-provider cloud-status-provider--${provider}`}
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
      <div className="cloud-status-provider__body">{renderStatus()}</div>
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
    <div className={`cloud-status-item cloud-status-item--${item.severity}`}>
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
          {item.link && (
            <button
              type="button"
              className="cloud-status-item__link"
              onClick={() => void globalThis.api?.openExternal(item.link)}
            >
              View details
            </button>
          )}
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!statusData) return [];
    const all = Object.values(statusData.providers).flat();
    const filtered = filter === 'all' ? all : all.filter((i) => i.provider === filter);
    // Sort by date descending
    return filtered.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  }, [statusData, filter]);

  if (!statusData && loading) return <TabFallback />;

  const errorProviders = new Set(statusData?.errors.map((e) => e.provider) ?? []);

  return (
    <div className="cloud-status">
      <div className="cloud-status__header">
        <div className="cloud-status__meta">
          <span className="cloud-status__updated">
            Updated {lastUpdatedLabel(statusData?.lastUpdated ?? 0)}
          </span>
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
        </div>
        <div className="cloud-status__filters">
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
      </div>

      <div className="cloud-status__summary">
        {CLOUD_STATUS_PROVIDER_ORDER.map((p) => (
          <ProviderCard
            key={p}
            provider={p}
            items={statusData?.providers[p] ?? []}
            hasError={errorProviders.has(p)}
          />
        ))}
      </div>

      <div className="cloud-status__feed">
        <div className="cloud-status__feed-title">Recent Events</div>
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
          items.map((item) => (
            <StatusItemCard
              key={item.id}
              item={item}
              isExpanded={expandedId === item.id}
              onToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
            />
          ))
        )}
      </div>

      <div className="cloud-status__footer">
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
    </div>
  );
};
