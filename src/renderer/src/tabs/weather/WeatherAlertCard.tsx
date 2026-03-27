import React from 'react';
import { Tooltip } from '../../components/Tooltip';
import type { WeatherAlert } from './types';
import { SEVERITY_COLORS } from './utils';

interface WeatherAlertCardProps {
  alert: WeatherAlert;
  isExpanded: boolean;
  onToggle: () => void;
}

const SeverityIcon: React.FC<{ severity: string; color: string }> = ({ severity, color }) => {
  const props = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'weather-alert-icon',
  };

  switch (severity) {
    case 'Extreme':
      // Zap / lightning bolt
      return (
        <svg {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'Severe':
      // Warning triangle with exclamation
      return (
        <svg {...props}>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'Minor':
      // Info circle
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    default:
      // Shield (Moderate / Unknown)
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
  }
};

export const WeatherAlertCard: React.FC<WeatherAlertCardProps> = ({
  alert,
  isExpanded,
  onToggle,
}) => {
  const colors = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS['Unknown']!;

  let badgeText: string = alert.severity;
  if (alert.severity === 'Unknown') {
    badgeText = alert.event.toLowerCase().includes('outlook') ? 'Outlook' : 'Advisory';
  }

  return (
    <Tooltip
      content={isExpanded ? 'Click to collapse' : 'Click to view full alert details'}
      position="top"
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-label={`Weather alert: ${alert.event}`}
        className="weather-alert-card"
        style={
          {
            '--alert-bg': colors.bg,
            '--alert-border': colors.border,
            '--alert-text': colors.text,
          } as React.CSSProperties
        }
        onClick={onToggle}
      >
        <div className="weather-alert-content">
          <SeverityIcon severity={alert.severity} color={colors.icon} />
          <div className="weather-alert-body">
            <div className="weather-alert-title-row">
              <span className="weather-alert-event">{alert.event}</span>
              <span className="weather-alert-badge">{badgeText}</span>
              {alert.urgency === 'Immediate' && (
                <span className="weather-alert-urgent-badge">🚨 Immediate</span>
              )}
            </div>
            <p className="weather-alert-headline">{alert.headline}</p>
            <div
              className={`weather-alert-expand${isExpanded ? ' weather-alert-expand--open' : ''}`}
            >
              <div className="weather-alert-expand-inner">
                <div className="weather-scroll-container weather-alert-expand-content">
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
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-tertiary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`weather-alert-expand-icon${isExpanded ? ' weather-alert-expand-icon--open' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>
    </Tooltip>
  );
};
