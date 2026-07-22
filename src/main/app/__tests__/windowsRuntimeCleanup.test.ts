import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupWindowsRuntimes, scheduleWindowsRuntimeCleanup } from '../windowsRuntimeCleanup';

const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'relay-runtime-cleanup-'));
  tempRoots.push(root);
  return root;
}

async function makeCompleteRuntime(runtimeRoot: string, buildId: string): Promise<string> {
  const directory = join(runtimeRoot, buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, '.relay-runtime-ready'),
    `[Relay]\nprotocol=1\nbuildId=${buildId}\n`,
  );
  await writeFile(join(directory, 'Relay.exe'), 'fixture');
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Windows runtime cleanup', () => {
  it('is scheduled after workspace readiness and cancelled during app cleanup', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');

    expect(source).toContain(
      "import { scheduleWindowsRuntimeCleanup } from './app/windowsRuntimeCleanup';",
    );
    expect(source).toContain('cancelWindowsRuntimeCleanup?.();');
    expect(source.indexOf("startupTimeline.mark('workspace-ready')")).toBeLessThan(
      source.indexOf('cancelWindowsRuntimeCleanup = scheduleWindowsRuntimeCleanup('),
    );
  });

  it('removes only unreferenced complete runtimes and stale staging directories', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const previousDir = await makeCompleteRuntime(runtimeRoot, 'r1-previous');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');
    const oldStage = join(runtimeRoot, '.staging-r1-old-123');
    const freshStage = join(runtimeRoot, '.staging-r1-fresh-456');
    await mkdir(oldStage, { recursive: true });
    await mkdir(freshStage, { recursive: true });
    const now = Date.now();
    await utimes(
      oldStage,
      new Date(now - 25 * 60 * 60 * 1000),
      new Date(now - 25 * 60 * 60 * 1000),
    );
    await writeFile(
      join(root, 'state.ini'),
      '[Relay]\nprotocol=1\ncurrent=r1-current\nprevious=r1-previous\n',
    );

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      nowMs: now,
    });

    expect(result.removed).toEqual(['.staging-r1-old-123', 'r1-orphan']);
    expect(result.skipped).toEqual(
      expect.arrayContaining(['.staging-r1-fresh-456', 'r1-current', 'r1-previous']),
    );
    expect(result.failed).toEqual([]);
    expect(existsSync(currentDir)).toBe(true);
    expect(existsSync(previousDir)).toBe(true);
    expect(existsSync(orphanDir)).toBe(false);
    expect(existsSync(oldStage)).toBe(false);
    expect(existsSync(freshStage)).toBe(true);
  });

  it('skips symlinks, unknown directories, and runtimes without a valid marker', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const outsideTarget = join(root, 'outside-target');
    const linkPath = join(runtimeRoot, 'r1-linked');
    const unknownDir = join(runtimeRoot, 'support-files');
    const incompleteDir = join(runtimeRoot, 'r1-incomplete');
    await mkdir(outsideTarget, { recursive: true });
    await symlink(outsideTarget, linkPath, 'dir');
    await mkdir(unknownDir, { recursive: true });
    await mkdir(incompleteDir, { recursive: true });
    await writeFile(join(root, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=../escape\n');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      nowMs: Date.now(),
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining(['r1-current', 'r1-incomplete', 'r1-linked', 'support-files']),
    );
    expect(existsSync(outsideTarget)).toBe(true);
    expect(existsSync(linkPath)).toBe(true);
    expect(existsSync(incompleteDir)).toBe(true);
  });

  it('does nothing when the executing Relay is outside the managed runtime root', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(root, 'Relay.exe'),
      nowMs: Date.now(),
    });

    expect(result).toEqual({ removed: [], skipped: [], failed: [] });
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('schedules cleanup after readiness and returns a cancellation function', async () => {
    const cleanup = vi.fn(async () => ({ removed: [], skipped: [], failed: [] }));
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    let scheduledCallback: (() => void) | undefined;
    const setTimer = vi.fn((callback: () => void) => {
      scheduledCallback = callback;
      return timer;
    });
    const clearTimer = vi.fn();

    const cancel = scheduleWindowsRuntimeCleanup({
      platform: 'win32',
      isPackaged: true,
      localAppData: 'C:\\Users\\relay\\AppData\\Local',
      execPath: 'C:\\Users\\relay\\AppData\\Local\\Relay\\Runtime\\r1-current\\Relay.exe',
      delayMs: 300_000,
      cleanup,
      setTimer,
      clearTimer,
    });

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 300_000);
    expect(unref).toHaveBeenCalledOnce();
    scheduledCallback?.();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    cancel();
    expect(clearTimer).toHaveBeenCalledWith(timer);
  });

  it('does not schedule outside a packaged Windows runtime', () => {
    const setTimer = vi.fn();

    scheduleWindowsRuntimeCleanup({ platform: 'darwin', isPackaged: true, setTimer });
    scheduleWindowsRuntimeCleanup({ platform: 'win32', isPackaged: false, setTimer });

    expect(setTimer).not.toHaveBeenCalled();
  });
});
