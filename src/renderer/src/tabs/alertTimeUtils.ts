import type { Severity } from './alertUtils';

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Event times on the card and in the exported email are always shown in Central Time. */
const CENTRAL_TZ = 'America/Chicago';

/** Severity-specific wording for the event time ("Started", "Scheduled", ...). */
export const EVENT_TIME_LABELS: Record<Severity, string> = {
  MAINTENANCE: 'Scheduled',
  ISSUE: 'Started',
  INFO: 'When',
  RESOLVED: 'Duration',
};

const EVENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: CENTRAL_TZ,
};

const EVENT_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: CENTRAL_TZ,
  timeZoneName: 'short',
};

/**
 * "April 5, 2026 · 2:00 AM CDT", with " – 4:00 AM CDT" appended for a same-day end or the full
 * end date and time for a later day. Takes ISO instants.
 */
export function formatEventTimeRange(startTime: string, endTime?: string): string {
  const startDate = new Date(startTime);
  const startDay = startDate.toLocaleDateString('en-US', EVENT_DATE_FORMAT);
  const start = `${startDay} · ${startDate.toLocaleTimeString('en-US', EVENT_TIME_FORMAT)}`;
  if (!endTime) return start;
  const endDate = new Date(endTime);
  const endDay = endDate.toLocaleDateString('en-US', EVENT_DATE_FORMAT);
  const endClock = endDate.toLocaleTimeString('en-US', EVENT_TIME_FORMAT);
  return endDay === startDay ? `${start} – ${endClock}` : `${start} – ${endDay} · ${endClock}`;
}

/** Offset of `timeZone` from UTC at the given instant, in ms (east = positive). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/**
 * Interpret a datetime-local string ("YYYY-MM-DDTHH:mm[:ss]") as wall-clock
 * time in `sourceTz` and return the corresponding UTC instant as ISO.
 * Uses formatToParts offset math (not string re-parsing) so DST transitions
 * resolve correctly; the second pass handles instants near a transition.
 */
export function localToIso(datetimeLocal: string, sourceTz: string): string {
  const match = DATETIME_LOCAL_RE.exec(datetimeLocal);
  if (!match) return '';
  const [, year, month, day, hour, minute, second] = match;
  const utcGuess = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  try {
    const offset = tzOffsetMs(new Date(utcGuess), sourceTz);
    let instant = utcGuess - offset;
    const offsetAtInstant = tzOffsetMs(new Date(instant), sourceTz);
    if (offsetAtInstant !== offset) instant = utcGuess - offsetAtInstant;
    return new Date(instant).toISOString();
  } catch {
    return ''; // invalid IANA zone
  }
}
