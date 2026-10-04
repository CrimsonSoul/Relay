/**
 * The one time-of-day format for status readouts ("Updated 2:01 PM", "Failing since 2:01 PM").
 * Matches the header clock (`WorldClock`): local time, 12-hour, numeric hour, two-digit minute.
 */
const OPS_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

type OpsTimeValue = Date | number | string;

export function formatOpsTime(value: OpsTimeValue): string {
  return OPS_TIME_FORMAT.format(value instanceof Date ? value : new Date(value));
}

/** The exact moment behind a status readout, for its Tooltip ("Sat, Oct 3, 2026, 4:16:02 PM CDT"). */
const OPS_DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

export function formatOpsDateTime(value: OpsTimeValue): string {
  return OPS_DATE_TIME_FORMAT.format(value instanceof Date ? value : new Date(value));
}

/** Age of a status readout ("just now", "4m ago", "2h ago", "3d ago"). */
export function formatOpsAge(value: OpsTimeValue, now: number = Date.now()): string {
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
