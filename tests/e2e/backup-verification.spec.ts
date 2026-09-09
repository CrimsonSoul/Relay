import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

// A dedicated app harness exercises the production parent with real utility
// processes and native SQLite, without starting Relay or touching its data.
test('backup deadline kills synchronous native SQLite before disposing its files', async () => {
  const root = resolve(import.meta.dirname, '../..');
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const fixture = mkdtempSync(join(root, 'tmp/backup-process-test-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const main = join(fixture, 'main.mjs');
    writeFileSync(
      main,
      "import { app, BrowserWindow } from 'electron'; import { verifyBackupArchive } from './verification.mjs'; import fs from 'node:fs'; globalThis.backupTest = { verifyBackupArchive, fs }; app.whenReady().then(() => { new BrowserWindow({show: false}).loadURL('about:blank'); });",
    );
    const wrapper = join(fixture, 'verification.mjs');
    writeFileSync(
      wrapper,
      ts.transpileModule(
        readFileSync(join(root, 'src/main/pocketbase/BackupVerification.ts'), 'utf8'),
        {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        },
      ).outputText,
    );
    const child = join(fixture, 'native.cjs');
    const marker = join(fixture, 'native-started.json');
    const sqlite = createRequire(import.meta.url).resolve('better-sqlite3');
    writeFileSync(
      child,
      `const fs = require('node:fs'); const db = new (require(${JSON.stringify(sqlite)}))(':memory:'); fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid})); db.prepare('WITH RECURSIVE t(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM t WHERE x<1000000000) SELECT sum(x) FROM t').get(); fs.writeFileSync(${JSON.stringify(join(fixture, 'query-finished'))}, 'unexpected completion');`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      args: [`--user-data-dir=${join(fixture, 'user-data')}`, main],
      env,
    });
    const result = await app.evaluate(
      async ({ app: runtime }, input) => {
        await runtime.whenReady();
        const { verifyBackupArchive, fs } = (
          globalThis as unknown as {
            backupTest: {
              verifyBackupArchive: (
                archive: string,
                data: string,
                options: { processPath: string; timeoutMs: number },
              ) => Promise<void>;
              fs: typeof import('node:fs');
            };
          }
        ).backupTest;
        const started = Date.now();
        let error = '';
        try {
          await verifyBackupArchive('unused.zip', input.fixture, {
            processPath: input.child,
            timeoutMs: 1500,
          });
        } catch (failure) {
          error = (failure as Error).message;
        }
        const elapsed = Date.now() - started;
        const native = JSON.parse(fs.readFileSync(input.marker, 'utf8')) as { pid: number };
        let alive = true;
        try {
          process.kill(native.pid, 0);
        } catch {
          alive = false;
        }
        return {
          error,
          elapsed,
          alive,
          temporary: fs
            .readdirSync(input.fixture)
            .filter((name) => name.startsWith('.relay-backup-verify-')),
          finished: fs.existsSync(input.finished),
        };
      },
      { fixture, child, marker, finished: join(fixture, 'query-finished') },
    );
    expect(result.error).toContain('timed out');
    expect(result.elapsed).toBeLessThan(5000);
    expect(result.alive).toBe(false);
    expect(result.finished).toBe(false);
    expect(result.temporary).toEqual([]);
  } finally {
    await app?.close();
    rmSync(fixture, { recursive: true, force: true });
  }
});
