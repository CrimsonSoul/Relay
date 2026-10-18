import { test, type ElectronApplication, type Page } from '@playwright/test';
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

/** Resolves false when the call does not settle within the budget (that event loop is blocked). */
async function answersWithin<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call().catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 3_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps the main process output (with the renderer console when ELECTRON_ENABLE_LOGGING is set),
 * whether the main and renderer event loops still answer, a capture of the window taken by the
 * main process, and Relay's own log. CI uploads test-results/ on failure.
 */
export async function writeAppDiagnostics(
  app: ElectronApplication,
  dataDir: string,
  output: readonly string[],
  page?: Page,
): Promise<void> {
  const mainResponds = await answersWithin(() => app.evaluate(() => true), false);
  const rendererResponds = page
    ? await answersWithin(() => page.evaluate(() => true), false)
    : 'not checked';
  const capture = mainResponds
    ? await answersWithin(
        () =>
          app.evaluate(async ({ BrowserWindow }) => {
            const image = await BrowserWindow.getAllWindows()[0]?.webContents.capturePage();
            return image?.toPNG().toString('base64') ?? null;
          }),
        null,
      )
    : null;
  const logFile = path.join(dataDir, 'logs', 'relay.log');
  const appLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '(no relay.log)';
  const file = test.info().outputPath('app-diagnostics.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (capture) fs.writeFileSync(test.info().outputPath('window-capture.png'), capture, 'base64');
  fs.writeFileSync(
    file,
    `main process responds: ${mainResponds}\nrenderer responds: ${rendererResponds}\n` +
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
