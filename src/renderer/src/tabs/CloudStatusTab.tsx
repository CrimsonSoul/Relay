import React, { useMemo } from 'react';
import {
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
} from '@shared/ipc';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { Tooltip } from '../components/Tooltip';

type ProviderPosture = 'outage' | 'unknown' | 'clear';

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

function providerPosture(items: CloudStatusItem[], hasFeedError: boolean): ProviderPosture {
  if (items.some((item) => item.severity === 'error')) return 'outage';
  if (hasFeedError) return 'unknown';
  return 'clear';
}

function postureLabel(posture: ProviderPosture): string {
  if (posture === 'outage') return 'Outage';
  if (posture === 'unknown') return 'Unknown';
  return 'No outage';
}

function postureRank(posture: ProviderPosture): number {
  if (posture === 'outage') return 0;
  if (posture === 'unknown') return 1;
  return 2;
}

function outageCountLabel(count: number): string {
  return `${count} active ${count === 1 ? 'outage' : 'outages'}`;
}

function sortProviders(
  providers: readonly CloudStatusProvider[],
  statusData: CloudStatusData | null,
  errorProviders: ReadonlySet<CloudStatusProvider>,
): CloudStatusProvider[] {
  return [...providers].sort((a, b) => {
    const aRank = postureRank(
      providerPosture(statusData?.providers[a] ?? [], errorProviders.has(a)),
    );
    const bRank = postureRank(
      providerPosture(statusData?.providers[b] ?? [], errorProviders.has(b)),
    );
    return aRank - bRank || providers.indexOf(a) - providers.indexOf(b);
  });
}

function openProviderStatus(provider: CloudStatusProvider): void {
  void globalThis.api?.openExternal(CLOUD_STATUS_PROVIDERS[provider].statusUrl);
}

const ProviderStatusAction: React.FC<{
  provider: CloudStatusProvider;
  className: string;
}> = ({ provider, className }) => (
  <button
    type="button"
    className={className}
    onClick={() => openProviderStatus(provider)}
    aria-label={`Open ${providerLabel(provider)} status page`}
  >
    <span aria-hidden="true">↗</span>
  </button>
);

const ProviderRow: React.FC<{
  provider: CloudStatusProvider;
  items: CloudStatusItem[];
  hasFeedError: boolean;
}> = ({ provider, items, hasFeedError }) => {
  const posture = providerPosture(items, hasFeedError);
  return (
    <article className={`cloud-status-provider cloud-status-provider--${posture}`}>
      <span
        className={`cloud-status-provider__signal cloud-status-provider__signal--${posture}`}
        aria-hidden="true"
      />
      <span className="cloud-status-provider__name">
        <ProviderIcon provider={provider} size={16} />
        {providerLabel(provider)}
      </span>
      <span className={`cloud-status-provider__state cloud-status-provider__state--${posture}`}>
        {postureLabel(posture)}
      </span>
      <ProviderStatusAction provider={provider} className="cloud-status-provider__source" />
    </article>
  );
};

const ProviderChip: React.FC<{
  provider: CloudStatusProvider;
  items: CloudStatusItem[];
  hasFeedError: boolean;
}> = ({ provider, items, hasFeedError }) => {
  const posture = providerPosture(items, hasFeedError);
  return (
    <button
      type="button"
      className={`cloud-status-provider-chip cloud-status-provider-chip--${posture}`}
      onClick={() => openProviderStatus(provider)}
      aria-label={`Open ${providerLabel(provider)} status page`}
    >
      <ProviderIcon provider={provider} size={15} />
      <span className="cloud-status-provider-chip__name">{providerLabel(provider)}</span>
      <span
        className={`cloud-status-provider-chip__state cloud-status-provider-chip__state--${posture}`}
      >
        {postureLabel(posture)}
      </span>
      <span className="cloud-status-provider-chip__arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
};

const OutageRow: React.FC<{ item: CloudStatusItem }> = ({ item }) => {
  const description = useMemo(() => stripHtml(item.description), [item.description]);
  return (
    <article className="cloud-status-outage">
      <div className="cloud-status-outage__meta">
        <span className="cloud-status-outage__severity">Outage</span>
        <span className="cloud-status-outage__provider">{providerLabel(item.provider)}</span>
        <time dateTime={item.pubDate}>{formatLocalTime(item.pubDate)}</time>
      </div>
      <h3>{item.title}</h3>
      <p>{description || 'No additional details were published.'}</p>
      <button
        type="button"
        onClick={() =>
          void globalThis.api?.openExternal(
            item.link || CLOUD_STATUS_PROVIDERS[item.provider].statusUrl,
          )
        }
      >
        View official status
        <span aria-hidden="true"> ↗</span>
      </button>
    </article>
  );
};

type StatusSummary = {
  tone: ProviderPosture;
  label: string;
};

function statusSummary(outageCount: number, hasFeedErrors: boolean): StatusSummary {
  if (outageCount > 0) return { tone: 'outage', label: outageCountLabel(outageCount) };
  if (hasFeedErrors) return { tone: 'unknown', label: 'Coverage incomplete' };
  return { tone: 'clear', label: 'No active vendor outages' };
}

function allClearCopy(hasFeedErrors: boolean): { title: string; detail: string; icon: string } {
  if (hasFeedErrors) {
    return {
      title: 'No reported outages from available feeds',
      detail: 'Relay is showing the status available from responding provider feeds.',
      icon: '?',
    };
  }
  return {
    title: 'No reported outages',
    detail: 'Relay is receiving status from every monitored provider.',
    icon: '✓',
  };
}

const FeedUnavailableNotice: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  return (
    <div className="cloud-status__notice" role="status">
      <strong>Some provider feeds are unavailable.</strong>
      <span>Last known data is shown where Relay has it.</span>
    </div>
  );
};

type StatusWorkspaceProps = {
  outages: CloudStatusItem[];
  providerOrder: CloudStatusProvider[];
  statusData: CloudStatusData | null;
  errorProviders: ReadonlySet<CloudStatusProvider>;
};

const OutageWorkspace: React.FC<StatusWorkspaceProps> = ({
  outages,
  providerOrder,
  statusData,
  errorProviders,
}) => (
  <div className="cloud-status__workspace">
    <section className="cloud-status__providers-panel" aria-label="Provider coverage">
      <div className="cloud-status__section-heading">
        <span>Provider coverage</span>
        <span>{CLOUD_STATUS_PROVIDER_ORDER.length} monitored</span>
      </div>
      <div className="cloud-status__provider-list">
        {providerOrder.map((provider) => (
          <ProviderRow
            key={provider}
            provider={provider}
            items={statusData?.providers[provider] ?? []}
            hasFeedError={errorProviders.has(provider)}
          />
        ))}
      </div>
    </section>
    <section className="cloud-status__outages-panel" aria-label="Active outages">
      <div className="cloud-status__section-heading">
        <span>Active outages</span>
        <span>{outages.length} shown</span>
      </div>
      <div className="cloud-status__outage-list">
        {outages.map((item) => (
          <OutageRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  </div>
);

const AllClearWorkspace: React.FC<Omit<StatusWorkspaceProps, 'outages'>> = ({
  providerOrder,
  statusData,
  errorProviders,
}) => {
  const hasFeedErrors = errorProviders.size > 0;
  const copy = allClearCopy(hasFeedErrors);
  const iconClassName = hasFeedErrors
    ? 'cloud-status__all-clear-icon cloud-status__all-clear-icon--unknown'
    : 'cloud-status__all-clear-icon';

  return (
    <div className="cloud-status__workspace cloud-status__workspace--clear">
      <section className="cloud-status__all-clear" aria-label="Provider coverage">
        <div className="cloud-status__section-heading">
          <span>Provider coverage</span>
          <span>{CLOUD_STATUS_PROVIDER_ORDER.length} monitored providers</span>
        </div>
        <div className="cloud-status__all-clear-body">
          <div className={iconClassName} aria-hidden="true">
            {copy.icon}
          </div>
          <h3>{copy.title}</h3>
          <p>{copy.detail}</p>
          <div className="cloud-status__provider-chips">
            {providerOrder.map((provider) => (
              <ProviderChip
                key={provider}
                provider={provider}
                items={statusData?.providers[provider] ?? []}
                hasFeedError={errorProviders.has(provider)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

const StatusWorkspace: React.FC<StatusWorkspaceProps> = (props) => {
  if (props.outages.length === 0) {
    return <AllClearWorkspace {...props} />;
  }
  return <OutageWorkspace {...props} />;
};

export const CloudStatusTab: React.FC<{
  statusData: CloudStatusData | null;
  loading: boolean;
  refetch: () => void;
}> = ({ statusData, loading, refetch }) => {
  const errorProviders = useMemo(
    () => new Set(statusData?.errors.map((error) => error.provider) ?? []),
    [statusData?.errors],
  );
  const allItems = useMemo(
    () => (statusData ? Object.values(statusData.providers).flat() : []),
    [statusData],
  );
  const outages = useMemo(
    () =>
      allItems
        .filter((item) => item.severity === 'error')
        .toSorted((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()),
    [allItems],
  );
  const providerOrder = useMemo(
    () => sortProviders(CLOUD_STATUS_PROVIDER_ORDER, statusData, errorProviders),
    [errorProviders, statusData],
  );

  if (!statusData && loading) return <TabFallback />;

  const hasFeedErrors = errorProviders.size > 0;
  const updatedLabel = `Updated ${lastUpdatedLabel(statusData?.lastUpdated ?? 0)}`;
  const summary = statusSummary(outages.length, hasFeedErrors);

  return (
    <div className="cloud-status">
      <header className="cloud-status__header">
        <div>
          <div className="cloud-status__context">Service status</div>
          <h2 className="cloud-status__title">External outages</h2>
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
      </header>

      <div className={`cloud-status__summary cloud-status__summary--${summary.tone}`} role="status">
        <span className="cloud-status__summary-signal" aria-hidden="true" />
        <strong>{summary.label}</strong>
        <span>across {CLOUD_STATUS_PROVIDER_ORDER.length} monitored providers</span>
      </div>

      <FeedUnavailableNotice visible={hasFeedErrors} />

      <StatusWorkspace
        outages={outages}
        providerOrder={providerOrder}
        statusData={statusData}
        errorProviders={errorProviders}
      />

      <StatusBar
        left={<StatusBarLive />}
        center={<span>{updatedLabel}</span>}
        right={
          <span className="cloud-status__status-summary">
            {CLOUD_STATUS_PROVIDER_ORDER.length} providers monitored ·{' '}
            {outageCountLabel(outages.length)}
          </span>
        }
      />
    </div>
  );
};
