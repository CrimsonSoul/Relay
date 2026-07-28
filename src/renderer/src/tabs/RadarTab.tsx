import React from 'react';
import { RADAR_STATUS_LABELS, type RadarRow } from '@shared/ipc';
import { TactileButton } from '../components/TactileButton';
import { useRadarSnapshot } from '../hooks/useRadarSnapshot';
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
          <td className="radar-table-name">{row.name}</td>
          <td className="radar-table-number">{row.depth.toLocaleString()}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const RadarTab: React.FC = () => {
  const { snapshot, refreshing, refresh, signIn } = useRadarSnapshot();
  const { color, dispatchers, papa, metrics, xcenter, currentTime, signInRequired, error } =
    snapshot;

  return (
    <div className="radar-tab">
      <header className="radar-tab-header">
        <div>
          <div className="radar-tab-context">RADAR</div>
          <h2 className="radar-tab-title">Dispatcher Radar</h2>
        </div>
        <div className="radar-tab-actions">
          <span className="radar-overall" data-radar-tone={color}>
            <span className="radar-overall-dot" aria-hidden="true" />
            {RADAR_STATUS_LABELS[color]}
          </span>
          <TactileButton
            variant="secondary"
            onClick={refresh}
            disabled={refreshing}
            title="Refresh now"
            aria-label="Refresh Radar now"
          >
            {refreshing ? 'REFRESHING' : 'REFRESH'}
          </TactileButton>
        </div>
      </header>

      {signInRequired && (
        <div className="radar-notice" role="status">
          <span>Your CW Dashboard session has expired.</span>
          <TactileButton variant="primary" onClick={signIn} aria-label="Sign in to CW Dashboard">
            SIGN IN
          </TactileButton>
        </div>
      )}

      {error && !signInRequired && (
        <div className="radar-notice radar-notice--error" role="status">
          Could not reach Radar: {error}
        </div>
      )}

      <section className="radar-lead" aria-label="XCenter counts">
        <div className="radar-figures">
          <div className="radar-figure">
            <span className="radar-figure-label">XCenter OK</span>
            <span className="radar-figure-value">{formatCount(xcenter.ok)}</span>
          </div>
          <div className="radar-figure">
            <span className="radar-figure-label">XCenter Pending</span>
            <span className="radar-figure-value">{formatCount(xcenter.pending)}</span>
          </div>
        </div>
      </section>

      <div className="radar-grid">
        {dispatchers.map((dispatcher) => (
          <section
            key={dispatcher.name}
            className="radar-panel"
            aria-label={`Dispatcher ${dispatcher.name} — ${RADAR_STATUS_LABELS[dispatcher.tone]}`}
          >
            <h3 className="radar-panel-title">
              <span
                className="radar-panel-dot"
                data-radar-tone={dispatcher.tone}
                aria-hidden="true"
              />
              {dispatcher.name}
            </h3>
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
        ))}

        {papa.length > 0 && (
          <section className="radar-panel" aria-label="PaPA Processor Service">
            <h3 className="radar-panel-title">PaPA Processor Service</h3>
            <DepthRows rows={papa} nameHeading="Message type" />
          </section>
        )}

        {metrics.length > 0 && (
          <section className="radar-panel" aria-label="Service metrics">
            <h3 className="radar-panel-title">Services</h3>
            <ul className="radar-metrics">
              {metrics.map((metric) => (
                <li key={metric.label} className="radar-metric">
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
          </section>
        )}
      </div>

      {currentTime && <p className="radar-updated">Dashboard clock: {currentTime}</p>}
    </div>
  );
};

export default RadarTab;
