import { Tooltip } from '../../components/Tooltip';
import type { WeatherAlert } from './types';
import { SEVERITY_COLORS } from './utils';

interface WeatherAlertCardProps {
  alert: WeatherAlert;
  isExpanded: boolean;
  onToggle: () => void;
}

export const WeatherAlertCard: React.FC<WeatherAlertCardProps> = ({
  alert,
  isExpanded,
  onToggle,
}) => {
  const colors = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS['Unknown'];

  return (
    <Tooltip
      content={isExpanded ? 'Click to collapse' : 'Click to view full alert details'}
      position="top"
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`Weather alert: ${alert.event}`}
        className="weather-alert-card"
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
        }}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="weather-alert-content">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={colors.icon}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="weather-alert-icon"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="weather-alert-body">
            <div className="weather-alert-title-row">
              <span className="weather-alert-event" style={{ color: colors.text }}>
                {alert.event}
              </span>
              <span className="weather-alert-badge" style={{ color: colors.text }}>
                {alert.severity === 'Unknown'
                  ? alert.event.toLowerCase().includes('outlook')
                    ? 'Outlook'
                    : 'Advisory'
                  : alert.severity}
              </span>
              {alert.urgency === 'Immediate' && (
                <span className="weather-alert-urgent-badge">🚨 Immediate</span>
              )}
            </div>
            <p className="weather-alert-headline">{alert.headline}</p>
            <div
              className={`weather-alert-expand${isExpanded ? ' weather-alert-expand--open' : ''}`}
            >
              <div className="weather-alert-expand-inner">
                <div
                  className="weather-scroll-container weather-alert-expand-content"
                  style={{ borderTop: `1px solid ${colors.border}` }}
                >
                  <p className="weather-alert-description">{alert.description}</p>
                  <div className="weather-alert-meta">
                    <span>Expires: {new Date(alert.expires).toLocaleString()}</span>
                    <span>{alert.senderName}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-tertiary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="weather-alert-expand-icon"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>
    </Tooltip>
  );
};
