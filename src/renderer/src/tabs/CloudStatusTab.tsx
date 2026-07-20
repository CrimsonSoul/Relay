import React, { useMemo } from 'react';
import {
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  downdetectorUrl,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
} from '@shared/ipc';
import { ProviderIcon } from '../components/icons/ProviderIcons';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { TabFallback } from '../components/TabFallback';
import { Tooltip } from '../components/Tooltip';
import { getCurrentCloudOutages } from '../utils/cloudStatus';

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

function providerPosture(hasOutage: boolean, hasFeedError: boolean): ProviderPosture {
  if (hasOutage) return 'outage';
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
  outageProviders: ReadonlySet<CloudStatusProvider>,
  errorProviders: ReadonlySet<CloudStatusProvider>,
): CloudStatusProvider[] {
  return [...providers].sort((a, b) => {
    const aRank = postureRank(providerPosture(outageProviders.has(a), errorProviders.has(a)));
    const bRank = postureRank(providerPosture(outageProviders.has(b), errorProviders.has(b)));
    return aRank - bRank || providers.indexOf(a) - providers.indexOf(b);
  });
}

const ProviderActions: React.FC<{ provider: CloudStatusProvider }> = ({ provider }) => {
  const config = CLOUD_STATUS_PROVIDERS[provider];
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
      {config.downdetectorSlug && (
        <button
          type="button"
          onClick={() =>
            void globalThis.api?.openExternal(downdetectorUrl(config.downdetectorSlug))
          }
          aria-label={`Open ${providerLabel(provider)} on Downdetector`}
        >
          Downdetector
        </button>
      )}
    </div>
  );
};

const ProviderRow: React.FC<{
  provider: CloudStatusProvider;
  hasOutage: boolean;
  hasFeedError: boolean;
}> = ({ provider, hasOutage, hasFeedError }) => {
  const posture = providerPosture(hasOutage, hasFeedError);
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
      <ProviderActions provider={provider} />
    </article>
  );
};

const ProviderChip: React.FC<{
  provider: CloudStatusProvider;
  hasOutage: boolean;
  hasFeedError: boolean;
}> = ({ provider, hasOutage, hasFeedError }) => {
  const posture = providerPosture(hasOutage, hasFeedError);
  return (
    <article
      className={`cloud-status-provider-chip cloud-status-provider-chip--${posture}`}
      aria-label={`${providerLabel(provider)} - ${postureLabel(posture)}`}
    >
      <span className="cloud-status-provider-chip__identity">
        <ProviderIcon provider={provider} size={15} />
        <span className="cloud-status-provider-chip__name">{providerLabel(provider)}</span>
      </span>
      <span
        className={`cloud-status-provider-chip__state cloud-status-provider-chip__state--${posture}`}
      >
        {postureLabel(posture)}
      </span>
      <ProviderActions provider={provider} />
    </article>
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

function statusSummary(
  outageCount: number,
  hasFeedErrors: boolean,
  snapshotUnavailable: boolean,
): StatusSummary {
  if (snapshotUnavailable) return { tone: 'unknown', label: 'Coverage unavailable' };
  if (outageCount > 0) return { tone: 'outage', label: outageCountLabel(outageCount) };
  if (hasFeedErrors) return { tone: 'unknown', label: 'Coverage incomplete' };
  return { tone: 'clear', label: 'No active vendor outages' };
}

function allClearCopy(
  hasFeedErrors: boolean,
  snapshotUnavailable: boolean,
): { title: string; detail: string } {
  if (snapshotUnavailable) {
    return {
      title: 'No status snapshot available',
      detail: 'Relay has not received provider status data yet.',
    };
  }
  if (hasFeedErrors) {
    return {
      title: 'No reported outages from available feeds',
      detail: 'Relay is showing the status available from responding provider feeds.',
    };
  }
  return {
    title: 'No reported outages',
    detail: 'Relay is receiving status from every monitored provider.',
  };
}

const CoverageStateIcon: React.FC<{ unknown: boolean }> = ({ unknown }) => (
  <svg
    className={`cloud-status__all-clear-icon${unknown ? ' cloud-status__all-clear-icon--unknown' : ''}`}
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

type StatusWorkspaceProps = {
  outages: CloudStatusItem[];
  providerOrder: CloudStatusProvider[];
  outageProviders: ReadonlySet<CloudStatusProvider>;
  errorProviders: ReadonlySet<CloudStatusProvider>;
  snapshotUnavailable: boolean;
};

const OutageWorkspace: React.FC<StatusWorkspaceProps> = ({
  outages,
  providerOrder,
  outageProviders,
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
            hasOutage={outageProviders.has(provider)}
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
  outageProviders,
  errorProviders,
  snapshotUnavailable,
}) => {
  const hasFeedErrors = errorProviders.size > 0;
  const copy = allClearCopy(hasFeedErrors, snapshotUnavailable);

  return (
    <div className="cloud-status__workspace cloud-status__workspace--clear">
      <section className="cloud-status__all-clear" aria-label="Provider coverage">
        <div className="cloud-status__section-heading">
          <span>Provider coverage</span>
          <span>{CLOUD_STATUS_PROVIDER_ORDER.length} monitored providers</span>
        </div>
        <div className="cloud-status__all-clear-body">
          <CoverageStateIcon unknown={hasFeedErrors} />
          <h3>{copy.title}</h3>
          <p>{copy.detail}</p>
          <div className="cloud-status__provider-chips">
            {providerOrder.map((provider) => (
              <ProviderChip
                key={provider}
                provider={provider}
                hasOutage={outageProviders.has(provider)}
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
    () =>
      new Set(
        statusData ? statusData.errors.map((error) => error.provider) : CLOUD_STATUS_PROVIDER_ORDER,
      ),
    [statusData],
  );
  const outages = useMemo(
    () =>
      statusData
        ? getCurrentCloudOutages(statusData).toSorted(
            (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
          )
        : [],
    [statusData],
  );
  const outageProviders = useMemo(() => new Set(outages.map((item) => item.provider)), [outages]);
  const providerOrder = useMemo(
    () => sortProviders(CLOUD_STATUS_PROVIDER_ORDER, outageProviders, errorProviders),
    [errorProviders, outageProviders],
  );

  if (!statusData && loading) return <TabFallback />;

  const snapshotUnavailable = statusData === null;
  const hasFeedErrors = errorProviders.size > 0;
  const updatedLabel = `Updated ${lastUpdatedLabel(statusData?.lastUpdated ?? 0)}`;
  const summary = statusSummary(outages.length, hasFeedErrors, snapshotUnavailable);

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

      <FeedUnavailableNotice
        hasFeedErrors={hasFeedErrors}
        snapshotUnavailable={snapshotUnavailable}
      />

      <StatusWorkspace
        outages={outages}
        providerOrder={providerOrder}
        outageProviders={outageProviders}
        errorProviders={errorProviders}
        snapshotUnavailable={snapshotUnavailable}
      />

      <StatusBar
        left={<StatusBarLive />}
        center={<span>{updatedLabel}</span>}
        right={
          <span className="cloud-status__status-summary">
            {CLOUD_STATUS_PROVIDER_ORDER.length} providers monitored ·{' '}
            {snapshotUnavailable ? 'coverage unavailable' : outageCountLabel(outages.length)}
          </span>
        }
      />
    </div>
  );
};
