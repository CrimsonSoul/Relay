const BUSINESS_HOURS = { START: 8, END: 17 };
const WEEKDAYS = { MONDAY: 1, FRIDAY: 5 };

export const isTimeWindowActive = (timeWindow: string, date: Date = new Date()): boolean => {
  if (!timeWindow) return false;
  const tw = timeWindow.toLowerCase().trim();

  // Basic shortcuts
  if (tw.includes("24/7") || tw.includes("always") || tw.includes("rotating")) return true;

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayAbbrevs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDay = date.getDay();
  const currentDayName = dayNames[currentDay];
  const currentDayAbbrev = dayAbbrevs[currentDay];

  // Business Hours Shortcut
  if (tw.includes("business hours")) {
    const hour = date.getHours();
    return currentDay >= WEEKDAYS.MONDAY && currentDay <= WEEKDAYS.FRIDAY && 
           hour >= BUSINESS_HOURS.START && hour < BUSINESS_HOURS.END;
  }

  // Handle Day Constraints (e.g., "Mon-Fri", "Saturday")
  let dayMatch = true;
  const hasDayMention = dayNames.some(d => tw.includes(d)) || dayAbbrevs.some(d => tw.includes(d));
  
  if (hasDayMention) {
    dayMatch = false;
    // Check for ranges like "Mon-Fri"
    const rangeMatch = tw.match(/(mon|tue|wed|thu|fri|sat|sun)\s*-\s*(mon|tue|wed|thu|fri|sat|sun)/);
    if (rangeMatch) {
      const startDay = dayAbbrevs.indexOf(rangeMatch[1]);
      const endDay = dayAbbrevs.indexOf(rangeMatch[2]);
      if (startDay <= endDay) {
        dayMatch = currentDay >= startDay && currentDay <= endDay;
      } else {
        // Over-weekend range (e.g., "Fri-Mon")
        dayMatch = currentDay >= startDay || currentDay <= endDay;
      }
    } else {
      // Check for individual day
      if (tw.includes(currentDayName) || tw.includes(currentDayAbbrev)) {
        dayMatch = true;
      }
    }
  }

  if (!dayMatch) return false;
  
  const hasTimeMention = tw.match(/\d/);
  if (!hasTimeMention) {
    // If it's a day match but no numbers (time) mentioned, it's active for that day
    return hasDayMention && dayMatch;
  }

  // Handle Time Constraints (e.g., "0800-1700", "8am-5pm", "08:00 - 17:00")
  const timeRangeMatch = tw.match(/(\d{1,2}[:.]?\d{0,2})\s*(am|pm)?\s*(?:-|to|through)\s*(\d{1,2}[:.]?\d{0,2})\s*(am|pm)?/);
  if (timeRangeMatch) {
    const parseTime = (timeStr: string, meridiem?: string): number => {
      let hours = 0;
      let mins = 0;
      
      const cleanTime = timeStr.replace(/[:.]/g, '');
      if (cleanTime.length <= 2) {
        hours = parseInt(cleanTime);
      } else {
        hours = parseInt(cleanTime.substring(0, cleanTime.length - 2));
        mins = parseInt(cleanTime.substring(cleanTime.length - 2));
      }

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      
      return hours * 100 + mins;
    };

    const startTime = parseTime(timeRangeMatch[1], timeRangeMatch[2]);
    const endTime = parseTime(timeRangeMatch[3], timeRangeMatch[4]);
    const currentTime = date.getHours() * 100 + date.getMinutes();

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Over-midnight range
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  // If we found numbers but couldn't parse a range, default to inactive for safety
  return false;
};
