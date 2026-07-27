import { spawnSync as defaultSpawnSync } from 'node:child_process';

const FAILED_TO_START_EXIT_CODE = 1;

const runChild = (spawnSync, command, args, options) => {
  try {
    const result = spawnSync(command, args, options);
    return {
      status: typeof result.status === 'number' ? result.status : null,
      signal: result.signal ?? null,
      error: result.error,
    };
  } catch (error) {
    return {
      status: null,
      signal: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

// A process exit code is truncated to its low byte, so a non-zero status whose
// low byte is zero (Windows reports values such as 256) would otherwise reach
// CI as a success.
const toReportableExitCode = (status) =>
  Math.trunc(status) % 256 === 0 ? FAILED_TO_START_EXIT_CODE : status;

const exitCodeFor = ({ status, signal, error }) => {
  if (!error && !signal && status === 0) return 0;
  return typeof status === 'number' && status !== 0
    ? toReportableExitCode(status)
    : FAILED_TO_START_EXIT_CODE;
};

const reportFailure = (label, outcome, stderr) => {
  if (outcome.error) {
    stderr.write(`${label} could not start: ${outcome.error.message}\n`);
    return;
  }
  if (outcome.signal) {
    stderr.write(`${label} terminated by signal ${outcome.signal}\n`);
    return;
  }
  stderr.write(`${label} failed with exit code ${exitCodeFor(outcome)}\n`);
};

export function runElectronTests({
  electronVersion,
  electronRebuildPath,
  playwrightPath,
  npmExecPath,
  nodePath = process.execPath,
  playwrightConfigPath = 'playwright.electron.config.ts',
  playwrightArgs = [],
  spawnSync = defaultSpawnSync,
  cwd = process.cwd(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const childOptions = { cwd, env, stdio: 'inherit' };

  stdout.write(`Rebuilding better-sqlite3 for Electron ${electronVersion}...\n`);
  const rebuildOutcome = runChild(
    spawnSync,
    nodePath,
    [
      electronRebuildPath,
      '--force',
      '--which-module',
      'better-sqlite3',
      '--version',
      electronVersion,
    ],
    childOptions,
  );

  let primaryLabel = 'Electron native rebuild';
  let primaryOutcome = rebuildOutcome;
  if (exitCodeFor(rebuildOutcome) === 0) {
    primaryLabel = 'Playwright';
    primaryOutcome = runChild(
      spawnSync,
      nodePath,
      [playwrightPath, 'test', '-c', playwrightConfigPath, ...playwrightArgs],
      childOptions,
    );
  }

  stdout.write('Restoring better-sqlite3 for the current Node ABI...\n');
  const restoreOutcome = npmExecPath
    ? runChild(
        spawnSync,
        nodePath,
        [npmExecPath, 'rebuild', 'better-sqlite3', '--build-from-source'],
        childOptions,
      )
    : {
        status: null,
        signal: null,
        error: new Error('npm_execpath is not set'),
      };

  const primaryExitCode = exitCodeFor(primaryOutcome);
  const restoreExitCode = exitCodeFor(restoreOutcome);
  if (primaryExitCode !== 0) reportFailure(primaryLabel, primaryOutcome, stderr);
  if (restoreExitCode !== 0) {
    reportFailure('Node ABI restoration', restoreOutcome, stderr);
  }

  return primaryExitCode !== 0 ? primaryExitCode : restoreExitCode;
}
