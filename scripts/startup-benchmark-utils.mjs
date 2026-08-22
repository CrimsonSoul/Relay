const STARTUP_SUMMARY_PREFIX = 'Relay startup timing ';
const STARTUP_SCENARIOS = new Set(['development', 'prepare', 'stable', 'portable']);
const STARTUP_OPTION_KEYS = new Map([
  ['--scenario', 'scenario'],
  ['--artifact', 'artifact'],
  ['--launcher', 'launcher'],
  ['--compression', 'compression'],
  ['--runs', 'runs'],
]);

function requireFlagValue(argv, index) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${argv[index]} requires a value.`);
  }
  return value;
}

function validateStartupBenchmarkOptions(options) {
  if (!STARTUP_SCENARIOS.has(options.scenario)) {
    throw new Error(`Unsupported startup benchmark scenario: ${options.scenario}`);
  }
  if (['prepare', 'portable'].includes(options.scenario) && !options.artifact) {
    throw new Error(`${options.scenario} scenario requires --artifact <Relay.exe>.`);
  }
  if (options.scenario === 'stable' && !options.launcher) {
    throw new Error('The stable scenario requires --launcher <installed Relay.exe>.');
  }
  if (!Number.isSafeInteger(options.runs) || options.runs < 1 || options.runs > 20) {
    throw new Error('Startup benchmark --runs must be an integer from 1 through 20.');
  }
  if (options.scenario === 'prepare' && options.runs !== 1) {
    throw new Error('The prepare scenario must use --runs 1 because later runs reuse the runtime.');
  }
  if (options.scenario === 'development' && options.runs !== 1) {
    throw new Error('The development scenario manages its own warm-run sample count.');
  }
}

export function parseStartupBenchmarkArgs(argv) {
  const options = {
    scenario: 'development',
    compression: 'development',
    runs: 1,
  };

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = requireFlagValue(argv, index);
    const optionKey = STARTUP_OPTION_KEYS.get(flag);
    if (!optionKey) throw new Error(`Unknown startup benchmark flag: ${flag}`);
    options[optionKey] = optionKey === 'runs' ? Number(value) : value;
  }

  validateStartupBenchmarkOptions(options);
  if (options.scenario !== 'development' && options.compression === 'development') {
    options.compression = 'unspecified';
  }

  return options;
}

export function buildLaunchSpec(options) {
  if (['prepare', 'portable'].includes(options.scenario) && options.artifact) {
    return { command: options.artifact, args: [] };
  }
  if (options.scenario === 'stable' && options.launcher) {
    return { command: options.launcher, args: [] };
  }
  throw new Error(`Cannot build a launch command for scenario: ${options.scenario}`);
}

export function sliceAppendedLogText(logBuffer, startByte) {
  if (!Buffer.isBuffer(logBuffer)) {
    throw new TypeError('Startup benchmark log data must be a Buffer.');
  }
  if (!Number.isSafeInteger(startByte) || startByte < 0 || startByte > logBuffer.length) {
    throw new RangeError('Startup benchmark log byte offset is outside the log buffer.');
  }
  return logBuffer.subarray(startByte).toString('utf8');
}

export async function waitForProcessQuiescence(
  isProcessActive,
  { idleChecks = 3, pollIntervalMs = 100, timeoutMs = 15_000 } = {},
) {
  if (typeof isProcessActive !== 'function') {
    throw new TypeError('Process quiescence requires an activity probe.');
  }
  if (!Number.isSafeInteger(idleChecks) || idleChecks < 1) {
    throw new RangeError('Process quiescence idleChecks must be a positive integer.');
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new RangeError('Process quiescence pollIntervalMs must be non-negative.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Process quiescence timeoutMs must be positive.');
  }

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let consecutiveIdleChecks = 0;

  while (Date.now() <= deadline) {
    if (await isProcessActive()) {
      consecutiveIdleChecks = 0;
    } else {
      consecutiveIdleChecks += 1;
      if (consecutiveIdleChecks >= idleChecks) {
        return Date.now() - startedAt;
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
  }

  throw new Error(`Relay runtime processes did not quiesce within ${timeoutMs}ms.`);
}

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
