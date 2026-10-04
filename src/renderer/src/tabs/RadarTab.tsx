import React from 'react';
import { RADAR_STATUS_LABELS, type RadarRow, type RadarSnapshot } from '@shared/ipc';
import { RADAR_URL } from '@shared/radar';
import { TactileButton } from '../components/TactileButton';
import { TabFreshness } from '../components/TabFreshness';
import { Tooltip } from '../components/Tooltip';
import { StatusBar, StatusBarLive } from '../components/StatusBar';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
import { getRelayRuntime } from '../runtime/relayRuntime';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from '../components/tab-chrome/TabChrome';
import { deriveRadarStatus, RADAR_RETRY_DESCRIPTION } from './radarStatus';
import { formatOpsTime } from '../utils/opsTime';
import './radar.css';

/**
 * Reconstructs the CW Dispatcher Radar board in Relay's own design system
 * rather than embedding the page. The source is a fixed-width table layout from
 * an ASP.NET app; rebuilding it means the board reflows with the window, honours
 * the active accent, and never floats a native view over Relay's own modals.
 *
 * Colour never carries meaning alone — every tone is paired with a word.
 */
function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

/**
 * Metric values arrive as the raw strings the dashboard printed. Grouping the
 * numeric ones keeps them readable beside the XCenter figures; anything that is
 * not a plain integer is passed through untouched rather than mangled.
 */
function formatMetricValue(value: string): string {
  const bare = value.replaceAll(',', '');
  if (!/^\d{1,15}$/.test(bare)) return value;
  return Number(bare).toLocaleString();
}

// The cause sentence names the cause and the check only; the meta line beneath carries the one
// retry instruction ("Use Refresh above to try now"), so the notice never tells you twice.
function radarErrorGuidance(error: string): string {
  const normalized = error.toLocaleLowerCase('en-US');
  if (normalized.includes('name_not_resolved') || normalized.includes('enotfound')) {
    return 'Relay could not find the Radar server. Check the trusted network or VPN.';
  }
  if (normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return 'The Radar server refused the connection. Confirm Radar is available.';
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return 'Radar did not respond before the request timed out. Check the network connection.';
  }
  return 'Relay could not refresh Radar. Check the trusted network or VPN.';
}

const DepthRows: React.FC<{ rows: RadarRow[]; nameHeading: string }> = ({ rows, nameHeading }) => (
  <table className="radar-table">
    <thead>
      <tr>
        <th scope="col">{nameHeading}</th>
        <th scope="col" className="radar-table-number">
          Depth
        </th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.name}>
          <td className="radar-table-name">
            {/* Long names ellipsize; the focusable trigger shows the full name on hover or focus. */}
            <Tooltip content={row.name} block>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
              <span className="radar-table-name-text" tabIndex={0}>
                {row.name}
              </span>
            </Tooltip>
          </td>
          <td className="radar-table-number">{row.depth.toLocaleString('en-US')}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// A plain labelled section like the refresh-failure notice: it holds the Sign In button, so it is
// not a live region; the tab's persistent announcer says the session expired.
const RadarSignInNotice: React.FC<
  Readonly<{ isWeb: boolean; hasUsableSnapshot: boolean; onSignIn: () => void }>
> = ({ isWeb, hasUsableSnapshot, onSignIn }) => (
  <section className="radar-notice" aria-label="CW Dashboard sign-in">
    {isWeb ? (
      <span>
        The Relay server PC&apos;s CW Dashboard session has expired. Open Relay Desktop on the
        server PC, sign in to CW Dashboard there, then refresh Radar.
      </span>
    ) : (
      <>
        <span>
          Your CW Dashboard session has expired.{' '}
          {hasUsableSnapshot ? 'Retained Radar data is stale.' : 'No Radar data yet.'}
        </span>
        <TactileButton variant="primary" onClick={onSignIn} aria-label="Sign In to CW Dashboard">
          Sign In
        </TactileButton>
      </>
    )}
  </section>
);

// Neutral tone, not a dispatch alarm: a failed fetch leaves the board unknown. This
// title is the only place the board status word appears while the notice is shown.
const RadarRefreshFailureNotice: React.FC<
  Readonly<{ statusLabel: string; error: string; lastUpdated: Date; failingSince: string | null }>
> = ({ statusLabel, error, lastUpdated, failingSince }) => (
  <section
    className="radar-notice radar-notice--error"
    aria-labelledby="radar-refresh-problem-title"
  >
    <div>
      <strong id="radar-refresh-problem-title" className="radar-notice__title">
        Radar refresh failed ({statusLabel})
      </strong>
      <p>{radarErrorGuidance(error)}</p>
      <p className="radar-notice__meta">
        Last good data from {formatOpsTime(lastUpdated)}, shown below.{' '}
        {failingSince ? `Failing since ${failingSince}. ` : ''}
        {RADAR_RETRY_DESCRIPTION} Use Refresh above to try now.
      </p>
    </div>
    <details className="radar-notice__details">
      <summary>Technical details</summary>
      <code>{error}</code>
    </details>
  </section>
);

// Nothing has ever loaded and the feed is failing: one block replaces the board's empty modules
// (five "no data" placeholders would only bury the cause). Same neutral rail as the notice above.
// It points at the command bar's Refresh, as the stale notice does; the page has one Refresh.
const RadarUnavailableBlock: React.FC<
  Readonly<{
    error: string;
    failingSince: string | null;
  }>
> = ({ error, failingSince }) => (
  <section
    className="radar-notice radar-notice--error radar-unavailable"
    aria-labelledby="radar-unavailable-title"
  >
    <div>
      <strong id="radar-unavailable-title" className="radar-notice__title">
        Radar unavailable
      </strong>
      <p>{radarErrorGuidance(error)}</p>
      <p className="radar-notice__meta">
        {failingSince ? `Failing since ${failingSince}. ` : 'No Radar data has loaded yet. '}
        {RADAR_RETRY_DESCRIPTION} Use Refresh above to try now.
      </p>
    </div>
    <details className="radar-notice__details">
      <summary>Technical details</summary>
      <code>{error}</code>
    </details>
  </section>
);

// The full board: shown whenever there is data to show, or nothing has failed yet (waiting).
const RadarBoard: React.FC<
  Readonly<{ snapshot: RadarSnapshot; hasUsableSnapshot: boolean; lastUpdatedDate: Date | null }>
> = ({ snapshot, hasUsableSnapshot, lastUpdatedDate }) => {
  const { dispatchers, papa, metrics, xcenter, currentTime } = snapshot;
  return (
    <div className="radar-workspace">
      <aside className="radar-health-rail" aria-label="Radar health summary">
        <section className="radar-health-section" aria-label="XCenter counts">
          <h3 className="radar-section-title">
            <span>XCenter</span>
          </h3>
          <div className="radar-figures">
            <div className="radar-figure">
              <span className="radar-figure-label">OK</span>
              <span className="radar-figure-value">{formatCount(xcenter.ok)}</span>
            </div>
            <div className="radar-figure">
              <span className="radar-figure-label">Pending</span>
              <span className="radar-figure-value">{formatCount(xcenter.pending)}</span>
            </div>
          </div>
        </section>

        <section className="radar-health-section" aria-label="PaPA Processor Service">
          <h3 className="radar-section-title">
            <span>PaPA Processor Service</span>
          </h3>
          {papa.length > 0 ? (
            <DepthRows rows={papa} nameHeading="Message type" />
          ) : (
            <p className="radar-empty">No PaPA data</p>
          )}
        </section>

        <section className="radar-health-section" aria-label="Service metrics">
          <h3 className="radar-section-title">Services</h3>
          {metrics.length > 0 ? (
            <ul className="radar-metrics">
              {metrics.map((metric) => (
                <li
                  key={metric.label}
                  className="radar-metric"
                  aria-label={`${metric.label} — ${RADAR_STATUS_LABELS[metric.tone]}${
                    metric.value === null ? '' : `: ${formatMetricValue(metric.value)}`
                  }`}
                >
                  <span className="radar-metric-label">
                    <span
                      className="radar-panel-dot"
                      data-radar-tone={metric.tone}
                      aria-hidden="true"
                    />
                    {metric.label}
                  </span>
                  <span className="radar-metric-value">
                    {metric.value === null
                      ? RADAR_STATUS_LABELS[metric.tone]
                      : formatMetricValue(metric.value)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="radar-empty">No service data</p>
          )}
        </section>

        <section className="radar-health-section" aria-label="Dashboard timing">
          <h3 className="radar-section-title">Dashboard timing</h3>
          <dl className="radar-clock">
            <div>
              <dt>Dashboard clock</dt>
              <dd>{currentTime ?? '—'}</dd>
            </div>
            <div>
              <dt>Last successful update</dt>
              <dd>
                {lastUpdatedDate ? (
                  <time dateTime={lastUpdatedDate.toISOString()}>
                    {lastUpdatedDate.toLocaleString()}
                  </time>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        </section>
      </aside>

      <section className="radar-dispatcher-lanes" aria-labelledby="radar-dispatchers-title">
        <h3 id="radar-dispatchers-title" className="radar-section-title">
          Dispatchers
        </h3>
        <div className="radar-lane-grid">
          {dispatchers.length > 0 ? (
            dispatchers.map((dispatcher) => (
              <section
                key={dispatcher.name}
                className="radar-lane"
                aria-label={`Dispatcher ${dispatcher.name} — ${RADAR_STATUS_LABELS[dispatcher.tone]}`}
              >
                <h4 className="radar-lane-title">
                  <span
                    className="radar-panel-dot"
                    data-radar-tone={dispatcher.tone}
                    aria-hidden="true"
                  />
                  {dispatcher.name}
                </h4>
                <dl className="radar-pairs">
                  <div>
                    <dt>Last schedule</dt>
                    <dd>{dispatcher.lastScheduleDate || '—'}</dd>
                  </div>
                  <div>
                    <dt>Last pub/sub</dt>
                    <dd>{dispatcher.lastPubSubDate || '—'}</dd>
                  </div>
                </dl>
                {dispatcher.queues.length > 0 ? (
                  <DepthRows rows={dispatcher.queues} nameHeading="Queue" />
                ) : (
                  <p className="radar-empty">No queues reported</p>
                )}
              </section>
            ))
          ) : (
            <p className="radar-empty radar-empty--workspace">
              {hasUsableSnapshot ? 'No dispatcher data reported' : 'No dispatcher data yet'}
            </p>
          )}
        </div>
      </section>
    </div>
  );
};

// The tab's single persistent announcement. Notices mount with their text, and a live region
// inserted already holding text is often not read, so this always-mounted output carries the change.
function radarAnnouncement(
  signInRequired: boolean,
  isWeb: boolean,
  showUnavailable: boolean,
  showFailure: boolean,
  label: string,
): string {
  if (signInRequired) {
    return isWeb
      ? 'CW Dashboard session expired on the Relay server PC. Sign in there to refresh Radar.'
      : 'CW Dashboard session expired. Sign in to refresh Radar.';
  }
  if (showUnavailable) return 'No Radar data has loaded and refreshes are failing.';
  if (showFailure) return `Radar refresh failed. Board status: ${label}.`;
  return `Radar status: ${label}.`;
}

export const RadarTab: React.FC = () => {
  const { snapshot, refreshing, refresh, signIn } = useRadarSnapshot();
  const { lastUpdated, signInRequired, error } = snapshot;
  const radarStatus = deriveRadarStatus(snapshot);
  const hasUsableSnapshot = radarStatus.state !== 'no-data';
  const lastUpdatedDate = hasUsableSnapshot ? new Date(lastUpdated) : null;
  const isWeb = getRelayRuntime().kind === 'web';
  // A failed refresh states the board status once, in the notice title; the header drops its
  // copy of the same word while that notice is on screen.
  const showRefreshFailure = Boolean(error) && !signInRequired;
  // Nothing retained and the feed failing: the single unavailable block stands in for the board.
  const showUnavailableBlock = showRefreshFailure && !hasUsableSnapshot;
  const refreshText = refreshing ? 'Refreshing…' : 'Refresh';

  return (
    <div className="radar-tab">
      <div className="radar-tab__body">
        <TabPageHeader
          title="Radar"
          subtitle="CW Dashboard"
          metadata={
            showRefreshFailure ? undefined : (
              <Tooltip content={radarStatus.description}>
                {/* Focusable so keyboard users reach the plain-language description too. */}
                <span
                  className="tab-page-status radar-overall"
                  data-radar-tone={radarStatus.tone}
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                  tabIndex={0}
                >
                  <span className="tab-page-status__dot radar-overall-dot" aria-hidden="true" />
                  {radarStatus.label}
                </span>
              </Tooltip>
            )
          }
        />
        <TabCommandBar ariaLabel="Radar actions">
          <TabCommandGroup kind="utility">
            {/* The page's single refresh control; the stale notice and the unavailable block
                point here. The visible word leads the name, so "Refreshing…" stays in it. */}
            <TactileButton
              variant="secondary"
              className="radar-refresh"
              onClick={refresh}
              disabled={refreshing}
              aria-label={`${refreshText} Radar`}
              tooltip={`Refresh Radar now. ${RADAR_RETRY_DESCRIPTION}`}
              icon={
                <svg
                  className={refreshing ? 'radar-refresh-icon--spinning' : ''}
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
            <TabFreshness
              at={lastUpdatedDate}
              stale={showRefreshFailure || signInRequired}
              label="Last good Radar data"
            />
            {/* Open Radar is always available (it opens the live dashboard in the browser), so it
                keeps the normal secondary style even while the feed is failing. ↗ marks that it
                leaves Relay; the glyph is aria-hidden so the name stays "Open Radar". */}
            <TactileButton
              variant="secondary"
              onClick={() => void globalThis.api?.openExternal(RADAR_URL)}
            >
              Open Radar <span aria-hidden="true">↗</span>
            </TactileButton>
          </TabCommandGroup>
        </TabCommandBar>
        <output className="sr-only">
          {radarAnnouncement(
            signInRequired,
            isWeb,
            showUnavailableBlock,
            showRefreshFailure,
            radarStatus.label,
          )}
        </output>

        {signInRequired && (
          <RadarSignInNotice
            isWeb={isWeb}
            hasUsableSnapshot={hasUsableSnapshot}
            onSignIn={signIn}
          />
        )}

        {showRefreshFailure && error && lastUpdatedDate && (
          <RadarRefreshFailureNotice
            statusLabel={radarStatus.label}
            error={error}
            lastUpdated={lastUpdatedDate}
            failingSince={radarStatus.failingSince}
          />
        )}

        {showUnavailableBlock && error ? (
          <RadarUnavailableBlock error={error} failingSince={radarStatus.failingSince} />
        ) : (
          <RadarBoard
            snapshot={snapshot}
            hasUsableSnapshot={hasUsableSnapshot}
            lastUpdatedDate={lastUpdatedDate}
          />
        )}
      </div>
      <StatusBar left={<StatusBarLive />} />
    </div>
  );
};
