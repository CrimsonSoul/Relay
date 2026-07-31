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
  const separator = String.raw`\s*(?:-|to|through)\s*`;
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

function checkTimeConstraints(tw: string, currentTime: number): boolean {
  // Composed RegExp to avoid SonarJS complexity complaints while fixing ReDoS
  const timeP = String.raw`(\d{1,2}[:.]?\d{2}|\d{1,4})`;
  const meridiem = `(am|pm)?`;
  const sep = String.raw`\s*(?:-|to|through)\s*`;
  const timeRegex = new RegExp(String.raw`${timeP}\s*${meridiem}${sep}${timeP}\s*${meridiem}`);

  const match = timeRegex.exec(tw);
  if (match) {
    const startTime = parseTimeStr(match[1]! + (match[2] || ''));
    const endTime = parseTimeStr(match[3]! + (match[4] || ''));

    if (startTime !== -1 && endTime !== -1) {
      if (startTime <= endTime) {
        return currentTime >= startTime && currentTime <= endTime;
      }
      return currentTime >= startTime || currentTime <= endTime;
    }
  }
  return false;
}

export const isTimeWindowActive = (timeWindow: string, date: Date = new Date()): boolean => {
  if (!timeWindow) return false;
  const tw = timeWindow.toLowerCase().trim();

  // Basic shortcuts
  if (tw.includes('24/7') || tw.includes('always') || tw.includes('rotating')) return true;

  const currentDay = date.getDay();

  // Business Hours Shortcut
  if (tw.includes('business hours')) {
    const hour = date.getHours();
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

  const currentTime = date.getHours() * 100 + date.getMinutes();
  return checkTimeConstraints(tw, currentTime);
};
