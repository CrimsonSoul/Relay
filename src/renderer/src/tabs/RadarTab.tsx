import React from 'react';
import { RADAR_STATUS_LABELS, type RadarRow } from '@shared/ipc';
import { RADAR_URL } from '@shared/radar';
import { TactileButton } from '../components/TactileButton';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
import { getRelayRuntime } from '../runtime/relayRuntime';
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
          <td className="radar-table-name" title={row.name}>
            {row.name}
          </td>
          <td className="radar-table-number">{row.depth.toLocaleString('en-US')}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const RadarTab: React.FC = () => {
  const { snapshot, refreshing, refresh, signIn } = useRadarSnapshot();
  const {
    color,
    dispatchers,
    papa,
    metrics,
    xcenter,
    currentTime,
    lastUpdated,
    signInRequired,
    error,
  } = snapshot;
  const isStale = signInRequired || Boolean(error);
  const hasUsableSnapshot = lastUpdated > 0;
  const overallTone = isStale ? 'unknown' : color;
  const overallLabel = isStale ? 'Stale' : RADAR_STATUS_LABELS[color];
  const lastUpdatedDate = hasUsableSnapshot ? new Date(lastUpdated) : null;
  const isWeb = getRelayRuntime().kind === 'web';

  return (
    <div className="radar-tab">
      <header className="radar-tab-header">
        <div>
          <div className="radar-tab-context">RADAR</div>
          <h2 className="radar-tab-title">Dispatcher Radar</h2>
        </div>
        <div className="radar-tab-actions">
          <span className="radar-overall" data-radar-tone={overallTone}>
            <span className="radar-overall-dot" aria-hidden="true" />
            {overallLabel}
          </span>
          <TactileButton
            variant="secondary"
            className="radar-header-action"
            onClick={() => void globalThis.api?.openExternal(RADAR_URL)}
            title="Open original Dispatcher Radar page"
            aria-label="Open original Dispatcher Radar page"
          >
            OPEN ORIGINAL
          </TactileButton>
          <button
            type="button"
            className="radar-refresh"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh Radar now"
          >
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
          </button>
        </div>
      </header>

      {/*
        <output> carries an implicit status role and is a live region, so a
        failure arriving on the next poll is announced without a redundant role
        attribute on a div.
      */}
      {signInRequired && (
        <output className="radar-notice">
          {isWeb ? (
            <span>
              The Relay server PC&apos;s CW Dashboard session has expired. Open Relay Desktop on the
              server PC, sign in to CW Dashboard there, then refresh Radar.
            </span>
          ) : (
            <>
              <span>Your CW Dashboard session has expired. Retained Radar data is stale.</span>
              <TactileButton
                variant="primary"
                onClick={signIn}
                aria-label="Sign in to CW Dashboard"
              >
                SIGN IN
              </TactileButton>
            </>
          )}
        </output>
      )}

      {error && !signInRequired && (
        <output className="radar-notice radar-notice--error">
          Could not reach Radar: {error}. Retained Radar data is stale.
        </output>
      )}

      <div className="radar-workspace">
        <aside className="radar-health-rail" aria-label="Radar health summary">
          <section className="radar-health-section" aria-label="XCenter counts">
            <h3 className="radar-section-title">XCenter</h3>
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
            <h3 className="radar-section-title">PaPA Processor Service</h3>
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
                {hasUsableSnapshot ? 'No dispatcher data reported' : 'Radar snapshot unavailable'}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default RadarTab;
