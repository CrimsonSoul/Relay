import React from 'react';
import type { Severity } from '../alertUtils';
import { EVENT_TIME_LABELS, formatEventTimeRange } from '../alertTimeUtils';

const CONTEXT_ICONS: Record<Severity, string> = {
  MAINTENANCE: '📅',
  ISSUE: '⏰',
  INFO: '📌',
  RESOLVED: '✅',
};

interface EventTimeBannerProps {
  severity: Severity;
  startTime?: string;
  endTime?: string;
}

export const EventTimeBanner: React.FC<EventTimeBannerProps> = ({
  severity,
  startTime,
  endTime,
}) => {
  if (!startTime) return null;

  return (
    <div className="alerts-email-event-time">
      <span className="alerts-email-event-time-icon">{CONTEXT_ICONS[severity]}</span>
      <span className="alerts-email-event-time-label">{EVENT_TIME_LABELS[severity]}</span>
      <span className="alerts-email-event-time-value">
        {formatEventTimeRange(startTime, endTime)}
      </span>
    </div>
  );
};
