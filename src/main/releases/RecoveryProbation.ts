import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseRecoveryCatalog } from './RecoveryCatalog';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_CATALOG_BYTES = 128 * 1_024;
const RESULT_FILE = 'probation-result.ini';

export type RecoveryProbationContext = {
  transactionId: string;
  buildId: string;
  relayRoot: string;
  resultPath: string;
};

type ResolveOptions = {
  relayRoot: string;
  execPath: string;
  transactionId: string;
};

type ControllerOptions = {
  durationMs: number;
  startupDeadlineMs?: number;
  isHealthy: () => boolean;
  writeHealthyReceipt: (durationMs: number) => void | Promise<void>;
  complete: (healthy: boolean) => void;
  now?: () => number;
};

function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const childRelative = relative(parent, child);
  return !isAbsolute(childRelative) && childRelative === expectedName;
}

export {
  parseRecoveryProbationArgument,
  type RecoveryProbationArgument,
} from './RecoveryProbationArgument';

async function resolveSafeRecoveryDirectory(relayRoot: string): Promise<string> {
  const recoveryDirectory = join(relayRoot, 'Recovery');
  const [realRelayRoot, stats, realRecoveryDirectory] = await Promise.all([
    realpath(relayRoot),
    lstat(recoveryDirectory),
    realpath(recoveryDirectory),
  ]);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !isDirectChild(realRelayRoot, realRecoveryDirectory, 'Recovery')
  ) {
    throw new Error('Relay recovery directory was redirected');
  }
  return realRecoveryDirectory;
}

async function resolveExecutingBuild(relayRoot: string, execPath: string): Promise<string> {
  const runtimeRoot = join(relayRoot, 'Runtime');
  const [realRelayRoot, runtimeStats, realRuntimeRoot, execStats, realExecPath] = await Promise.all(
    [
      realpath(relayRoot),
      lstat(runtimeRoot),
      realpath(runtimeRoot),
      lstat(execPath),
      realpath(execPath),
    ],
  );
  if (
    !runtimeStats.isDirectory() ||
    runtimeStats.isSymbolicLink() ||
    !isDirectChild(realRelayRoot, realRuntimeRoot, 'Runtime') ||
    !execStats.isFile() ||
    execStats.isSymbolicLink()
  ) {
    throw new Error('Relay probation runtime was redirected');
  }
  const runtimeDirectory = dirname(realExecPath);
  const buildId = basename(runtimeDirectory);
  const runtimeRelative = relative(realRuntimeRoot, runtimeDirectory);
  if (isAbsolute(runtimeRelative) || runtimeRelative !== buildId) {
    throw new Error('Relay probation executable was outside the managed runtime');
  }
  return buildId;
}

export async function resolveRecoveryProbationContext(
  options: ResolveOptions,
): Promise<RecoveryProbationContext> {
  if (!UUID_V4_PATTERN.test(options.transactionId)) {
    throw new Error('Relay probation transaction was invalid');
  }
  const relayRoot = await realpath(resolve(options.relayRoot));
  const [buildId, recoveryDirectory, stateStats] = await Promise.all([
    resolveExecutingBuild(relayRoot, options.execPath),
    resolveSafeRecoveryDirectory(relayRoot),
    lstat(join(relayRoot, 'state.ini')),
  ]);
  if (!stateStats.isFile() || stateStats.isSymbolicLink() || stateStats.size > MAX_CATALOG_BYTES) {
    throw new Error('Relay recovery catalog was invalid');
  }
  const catalog = parseRecoveryCatalog(await readFile(join(relayRoot, 'state.ini'), 'utf8'));
  const transaction = catalog?.transaction;
  const candidate = catalog?.builds.find((build) => build.buildId === catalog.candidateBuildId);
  if (
    !catalog ||
    !transaction ||
    transaction.id !== options.transactionId ||
    transaction.kind !== 'update' ||
    transaction.phase !== 'probation' ||
    transaction.sourceBuildId !== catalog.currentBuildId ||
    transaction.targetBuildId !== catalog.candidateBuildId ||
    catalog.candidateBuildId !== buildId ||
    candidate?.health !== 'candidate'
  ) {
    throw new Error('Relay probation transaction did not match the recovery catalog');
  }
  return {
    transactionId: options.transactionId,
    buildId,
    relayRoot,
    resultPath: join(recoveryDirectory, RESULT_FILE),
  };
}

export async function writeRecoveryProbationReceipt(
  context: RecoveryProbationContext,
  durationMs: number,
): Promise<void> {
  if (!Number.isSafeInteger(durationMs) || durationMs < 60_000) {
    throw new TypeError('Relay probation duration was invalid');
  }
  const recoveryDirectory = await resolveSafeRecoveryDirectory(context.relayRoot);
  const expectedResultPath = join(recoveryDirectory, RESULT_FILE);
  if (resolve(context.resultPath) !== resolve(expectedResultPath)) {
    throw new Error('Relay probation receipt path was redirected');
  }
  const temporaryPath = join(recoveryDirectory, `.probation-result.${randomUUID()}.tmp`);
  const contents = `${[
    '[Probation]',
    'protocol=2',
    `transactionId=${context.transactionId}`,
    `buildId=${context.buildId}`,
    'status=healthy',
    `durationMs=${durationMs}`,
  ].join('\r\n')}\r\n`;
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, expectedResultPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function createRecoveryProbationController(options: ControllerOptions) {
  const now = options.now ?? Date.now;
  let rendererMounted = false;
  let localStartupComplete = false;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  const startupDeadline = setTimeout(
    () => finish(false),
    options.startupDeadlineMs ?? options.durationMs * 2,
  );
  startupDeadline.unref?.();

  const finish = (healthy: boolean) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    timer = null;
    clearTimeout(startupDeadline);
    options.complete(healthy);
  };
  const arm = () => {
    if (finished || timer || !rendererMounted || !localStartupComplete) return;
    clearTimeout(startupDeadline);
    startedAt = now();
    timer = setTimeout(() => {
      timer = null;
      const durationMs = Math.max(0, Math.round(now() - startedAt));
      if (durationMs < options.durationMs) {
        arm();
        return;
      }
      if (!options.isHealthy()) {
        finish(false);
        return;
      }
      void Promise.resolve(options.writeHealthyReceipt(durationMs)).then(
        () => finish(true),
        () => finish(false),
      );
    }, options.durationMs);
    timer.unref?.();
  };

  return {
    markRendererMounted: () => {
      rendererMounted = true;
      arm();
    },
    markLocalStartupComplete: () => {
      localStartupComplete = true;
      arm();
    },
    fail: () => finish(false),
    dispose: () => {
      finished = true;
      if (timer) clearTimeout(timer);
      timer = null;
      clearTimeout(startupDeadline);
    },
  };
}
