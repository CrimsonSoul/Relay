import React from 'react';
import type { Severity } from '../alertUtils';

const CONTEXT_LABELS: Record<Severity, string> = {
  MAINTENANCE: 'Scheduled',
  ISSUE: 'Started',
  INFO: 'When',
  RESOLVED: 'Duration',
};

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

const CENTRAL_TZ = 'America/Chicago';

function formatEventDateTime(isoString: string): string {
  const date = new Date(isoString);
  return (
    date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: CENTRAL_TZ,
    }) +
    ' · ' +
    date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: CENTRAL_TZ,
      timeZoneName: 'short',
    })
  );
}

function formatTimeOnly(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CENTRAL_TZ,
    timeZoneName: 'short',
  });
}

export const EventTimeBanner: React.FC<EventTimeBannerProps> = ({
  severity,
  startTime,
  endTime,
}) => {
  if (!startTime) return null;

  const label = CONTEXT_LABELS[severity];
  const icon = CONTEXT_ICONS[severity];

  const endDate = endTime ? new Date(endTime) : null;
  const sameDay =
    endDate &&
    (() => {
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { timeZone: CENTRAL_TZ });
      return fmt(new Date(startTime)) === fmt(endDate);
    })();

  let timeDisplay: string;
  if (endDate && sameDay) {
    timeDisplay = formatEventDateTime(startTime).replace(
      /(\d{2}:\d{2}\s*\w+)$/,
      `$1 – ${formatTimeOnly(endTime!)}`,
    );
  } else if (endDate) {
    timeDisplay = `${formatEventDateTime(startTime)} – ${formatEventDateTime(endTime!)}`;
  } else {
    timeDisplay = formatEventDateTime(startTime);
  }

  return (
    <div className="alerts-email-event-time">
      <span className="alerts-email-event-time-icon">{icon}</span>
      <span className="alerts-email-event-time-label">{label}</span>
      <span className="alerts-email-event-time-value">{timeDisplay}</span>
    </div>
  );
};
