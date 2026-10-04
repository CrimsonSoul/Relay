const BUSINESS_HOURS = { START: 8, END: 17 };
const WEEKDAYS = { MONDAY: 1, FRIDAY: 5 };

const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Matches a day range written with abbreviations or full names, in any mix:
 * "mon-fri", "Monday-Friday", "monday to fri", "mon through friday".
 * The capture groups stay the three-letter abbreviations so callers can index
 * straight into `dayAbbrevs`. Full names are accepted via the optional suffix —
 * without it, "monday-friday" matched nothing and only the two endpoint days
 * were treated as in-window.
 */
function dayRangeRegex(): RegExp {
  const day = '(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?';
  const separator = String.raw`\s*(?:-|–|—|to|through)\s*`;
  return new RegExp(`${day}${separator}${day}`);
}

function checkDayConstraints(
  tw: string,
  currentDay: number,
): { hasDayMention: boolean; dayMatch: boolean } {
  let dayMatch = true;
  const hasDayMention =
    dayNames.some((d) => tw.includes(d)) || dayAbbrevs.some((d) => tw.includes(d));

  if (!hasDayMention) return { hasDayMention, dayMatch };

  dayMatch = false;
  const rangeMatch = dayRangeRegex().exec(tw);
  if (rangeMatch) {
    const startDay = dayAbbrevs.indexOf(rangeMatch[1]!);
    const endDay = dayAbbrevs.indexOf(rangeMatch[2]!);
    if (startDay <= endDay) {
      dayMatch = currentDay >= startDay && currentDay <= endDay;
    } else {
      dayMatch = currentDay >= startDay || currentDay <= endDay;
    }
  } else {
    const currentDayName = dayNames[currentDay]!;
    const currentDayAbbrev = dayAbbrevs[currentDay]!;
    if (tw.includes(currentDayName) || tw.includes(currentDayAbbrev)) {
      dayMatch = true;
    }
  }
  return { hasDayMention, dayMatch };
}

function parseTimeStr(timeStr: string): number {
  const timeFormatRegex = /^(\d{1,2}[:.]?\d{2}|\d{1,4})\s*(am|pm)?$/;
  const match = timeFormatRegex.exec(timeStr.trim());
  if (!match) return -1;

  let hours = 0;
  let mins = 0;

  const cleanTime = match[1]!.replaceAll(/[:.]/g, '');
  if (cleanTime.length <= 2) {
    hours = Number.parseInt(cleanTime, 10);
  } else {
    hours = Number.parseInt(cleanTime.substring(0, cleanTime.length - 2), 10);
    mins = Number.parseInt(cleanTime.substring(cleanTime.length - 2), 10);
  }

  const meridiem = match[2];
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  return hours * 100 + mins;
}

// Composed RegExp to avoid SonarJS complexity complaints while fixing ReDoS
function timeRangeRegex(flags = ''): RegExp {
  const timeP = String.raw`(\d{1,2}[:.]?\d{2}|\d{1,4})`;
  const meridiem = `(am|pm)?`;
  const sep = String.raw`\s*(?:-|–|—|to|through)\s*`;
  return new RegExp(String.raw`${timeP}\s*${meridiem}${sep}${timeP}\s*${meridiem}`, flags);
}

function parseTimeRange(tw: string): { start: number; end: number } | null {
  const match = timeRangeRegex().exec(tw);
  if (!match) return null;
  const start = parseTimeStr(match[1]! + (match[2] || ''));
  const end = parseTimeStr(match[3]! + (match[4] || ''));
  return start === -1 || end === -1 ? null : { start, end };
}

// A window runs from its start up to, not including, its end, so back-to-back shifts
// ("06:00–18:00" then "18:00–06:00") never both count as active at the handover minute.
// Equal start and end ("08:00–08:00") is a full day.
function checkTimeConstraints(tw: string, currentTime: number): boolean {
  const range = parseTimeRange(tw);
  if (!range) return false;
  if (range.start === range.end) return true;
  if (range.start < range.end) {
    return currentTime >= range.start && currentTime < range.end;
  }
  return currentTime >= range.start || currentTime < range.end;
}

/** US zone words a window may name ("06:00–18:00 ET"); unnamed windows are local time. */
const ZONE_ALIASES: Record<string, string> = {
  et: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  eastern: 'America/New_York',
  ct: 'America/Chicago',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  central: 'America/Chicago',
  mt: 'America/Denver',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mountain: 'America/Denver',
  pt: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  utc: 'UTC',
  gmt: 'UTC',
};

const ZONE_REGEX = new RegExp(String.raw`\s*\b(${Object.keys(ZONE_ALIASES).join('|')})\b`, 'i');

type WallClock = { year: number; month: number; day: number; weekday: number; time: number };

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock (date, weekday, HHMM) an instant shows in `timeZone`. */
function wallClockIn(date: Date, timeZone: string): WallClock {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    weekday: dayAbbrevs.indexOf(String(parts.weekday).toLowerCase()),
    time: Number(parts.hour) * 100 + Number(parts.minute),
  };
}

/** The instant at which `timeZone`'s wall clock reads `hhmm` on the given calendar day. */
function instantAt(wall: WallClock, hhmm: number, timeZone: string): Date {
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, Math.floor(hhmm / 100), hhmm % 100);
  // Correct by the zone's offset, twice so a DST change between the guess and the answer lands.
  let instant = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = wallClockIn(new Date(instant), timeZone);
    const shownUtc = Date.UTC(
      shown.year,
      shown.month,
      shown.day,
      Math.floor(shown.time / 100),
      shown.time % 100,
    );
    instant += asUtc - shownUtc;
  }
  return new Date(instant);
}

function formatClock(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hour12 = hours % 12 || 12;
  const meridiem = hours < 12 ? 'AM' : 'PM';
  return minutes === 0
    ? `${hour12} ${meridiem}`
    : `${hour12}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

/**
 * A saved on-call window as this computer reads it: the time range in 12-hour local time, with
 * any named zone ("ET") converted and dropped ("06:00–18:00 ET" → "5 AM – 5 PM" in Central).
 * Text with no recognisable range ("24/7", "Business hours") is returned unchanged, and so is a
 * bare-hour range such as "9-5", whose meaning (9 AM–5 PM or overnight) only its author knows.
 * Display only: the saved text is never rewritten.
 */
export function formatTimeWindow(timeWindow: string, date: Date = new Date()): string {
  const zoneMatch = ZONE_REGEX.exec(timeWindow);
  const timeZone = zoneMatch ? ZONE_ALIASES[zoneMatch[1]!.toLowerCase()] : undefined;
  const text = zoneMatch ? timeWindow.replace(ZONE_REGEX, '') : timeWindow;

  const match = timeRangeRegex('i').exec(text);
  if (!match) return timeWindow;
  const isExplicit = (digits: string, meridiem?: string) =>
    Boolean(meridiem) || digits.replaceAll(/[:.]/g, '').length >= 3;
  if (!isExplicit(match[1]!, match[2]) || !isExplicit(match[3]!, match[4])) return timeWindow;
  const range = parseTimeRange(match[0].toLowerCase());
  if (!range) return timeWindow;

  const toLocal = (hhmm: number): Date => {
    if (!timeZone) {
      const local = new Date(date);
      local.setHours(Math.floor(hhmm / 100), hhmm % 100, 0, 0);
      return local;
    }
    return instantAt(wallClockIn(date, timeZone), hhmm, timeZone);
  };
  const formatted = `${formatClock(toLocal(range.start))} – ${formatClock(toLocal(range.end))}`;
  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index + match[0].length).trimStart();
  return [before, formatted, after].filter(Boolean).join(' ');
}

export const isTimeWindowActive = (timeWindow: string, date: Date = new Date()): boolean => {
  if (!timeWindow) return false;
  const tw = timeWindow.toLowerCase().trim();

  // Basic shortcuts
  if (tw.includes('24/7') || tw.includes('always') || tw.includes('rotating')) return true;

  // A window that names its zone is judged by that zone's clock, not this computer's.
  const zoneMatch = ZONE_REGEX.exec(tw);
  const timeZone = zoneMatch ? ZONE_ALIASES[zoneMatch[1]!] : undefined;
  const wall = timeZone
    ? wallClockIn(date, timeZone)
    : { weekday: date.getDay(), time: date.getHours() * 100 + date.getMinutes() };
  const currentDay = wall.weekday;

  // Business Hours Shortcut
  if (tw.includes('business hours')) {
    const hour = Math.floor(wall.time / 100);
    return (
      currentDay >= WEEKDAYS.MONDAY &&
      currentDay <= WEEKDAYS.FRIDAY &&
      hour >= BUSINESS_HOURS.START &&
      hour < BUSINESS_HOURS.END
    );
  }

  const { hasDayMention, dayMatch } = checkDayConstraints(tw, currentDay);
  if (!dayMatch) return false;

  const hasTimeMention = /\d/.test(tw);
  if (!hasTimeMention) {
    // If it's a day match but no numbers (time) mentioned, it's active for that day
    return hasDayMention && dayMatch;
  }

  return checkTimeConstraints(tw, wall.time);
};
