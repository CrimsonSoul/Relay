const STARTUP_SUMMARY_PREFIX = 'Relay startup timing ';

export function median(samples) {
  if (samples.length === 0) {
    throw new Error('Startup benchmark requires at least one sample.');
  }
  if (samples.some((sample) => !Number.isFinite(sample))) {
    throw new TypeError('Startup benchmark samples must be finite numbers.');
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function extractLatestStartupTimeline(logText) {
  const lines = logText.split(/\r?\n/);
  const summaries = lines
    .map((line) => line.indexOf(STARTUP_SUMMARY_PREFIX))
    .map((index, lineNumber) => ({ index, line: lines[lineNumber] }))
    .filter(({ index }) => index >= 0)
    .map(({ index, line }) => line.slice(index + STARTUP_SUMMARY_PREFIX.length));

  for (const summary of summaries.reverse()) {
    try {
      const parsed = JSON.parse(summary);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every((value) => Number.isFinite(value) && value >= 0)
      ) {
        return parsed;
      }
    } catch {
      // A partial final log write must not hide an earlier complete launch.
    }
  }

  return null;
}
