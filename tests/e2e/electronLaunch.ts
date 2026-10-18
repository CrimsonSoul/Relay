import { test, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Main-process stdout and stderr, kept for diagnostics when a launch never becomes ready. */
export function recordElectronOutput(app: ElectronApplication): string[] {
  const output: string[] = [];
  const record = (chunk: Buffer) => output.push(chunk.toString('utf8'));
  app.process().stdout?.on('data', record);
  app.process().stderr?.on('data', record);
  return output;
}

/** Resolves false when the main process does not answer within the budget (its loop is blocked). */
async function mainProcessResponds(app: ElectronApplication): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      app.evaluate(() => true).catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 3_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps the main process output, whether its event loop still answers, and Relay's own log beside
 * a launch that never became ready. CI uploads test-results/ on failure.
 */
export async function writeStartupDiagnostics(
  app: ElectronApplication,
  dataDir: string,
  output: readonly string[],
): Promise<void> {
  const responds = await mainProcessResponds(app);
  const logFile = path.join(dataDir, 'logs', 'relay.log');
  const appLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '(no relay.log)';
  const file = test.info().outputPath('startup-diagnostics.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `main process responds: ${responds}\n` +
      `--- main process output ---\n${output.join('')}\n--- relay.log ---\n${appLog}\n`,
  );
}

/**
 * Closes an Electron app, and kills it with its embedded PocketBase when a stuck main process
 * cannot finish quitting, so one hung launch does not also exhaust the test and worker budgets.
 */
export async function closeElectronApp(app: ElectronApplication, dataDir: string): Promise<void> {
  const child = app.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = await Promise.race([
    app.close().then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 10_000);
    }),
  ]);
  clearTimeout(timer);
  if (closed || child.exitCode !== null) return;
  child.kill('SIGKILL');
  if (process.platform !== 'win32' && dataDir) {
    try {
      execFileSync('/usr/bin/pkill', ['-KILL', '-f', dataDir]);
    } catch {
      // pkill exits 1 when no process matched.
    }
  }
}
