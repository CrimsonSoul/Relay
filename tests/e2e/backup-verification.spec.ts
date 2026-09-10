import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import PocketBase from 'pocketbase';

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

for (const failStartup of [false, true])
  test(
    failStartup
      ? 'failed restored server startup recovers original running data'
      : 'completed restore exposes original records, IDs, unknown collections and files',
    async () => {
      test.setTimeout(180_000);
      const root = resolve(import.meta.dirname, '../..');
      mkdirSync(join(root, 'tmp'), { recursive: true });
      const profile = mkdtempSync(join(root, 'tmp/restore-test-'));
      const socket = createServer();
      await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
      const address = socket.address();
      if (!address || typeof address === 'string') throw new Error('Missing test port');
      const port = address.port;
      await new Promise<void>((done) => socket.close(() => done()));
      const secret = `synthetic-${randomUUID()}`;
      mkdirSync(join(profile, 'data'));
      writeFileSync(
        join(profile, 'data/config.json'),
        JSON.stringify({
          mode: 'server',
          port,
          bindHost: '127.0.0.1',
          lanAccessConfigured: true,
          web: { enabled: false, port: 8091 },
          secret,
        }),
        { mode: 0o600 },
      );
      const env = { ...process.env, NODE_ENV: 'test' };
      delete env.ELECTRON_RUN_AS_NODE;
      let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
      try {
        app = await electron.launch({
          args: [`--user-data-dir=${profile}`, join(root, 'dist/main/index.js')],
          env,
        });
        const page = await app.firstWindow();
        await expect(page.getByTestId('sidebar-compose')).toBeVisible();
        const pb = new PocketBase(`http://127.0.0.1:${port}`);
        pb.autoCancellation(false);
        await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);
        const contact = await pb
          .collection('contacts')
          .create({ name: 'Before restore', email: 'fixture@relay.invalid' });
        await pb.collections.create({
          name: 'operator_custom_fixture',
          type: 'base',
          fields: [{ name: 'value', type: 'text' }],
        });
        const unknown = await pb
          .collection('operator_custom_fixture')
          .create({ value: 'Preserve me' });
        const file = join(profile, 'data/pb_data/operator-file.txt');
        writeFileSync(file, 'Original file');
        const backup = await page.evaluate(() => globalThis.window.api.createBackup());
        expect(backup.success).toBe(true);
        if (!backup.success || !backup.data) throw new Error('Missing backup');
        const name = backup.data.split(/[\\/]/).at(-1)!;
        await pb.collection('contacts').update(contact.id, { name: 'After backup' });
        await pb.collection('operator_custom_fixture').delete(unknown.id);
        writeFileSync(file, 'Changed file');
        if (failStartup) {
          await app.evaluate(() => {
            const original = globalThis.fetch;
            let failed = false;
            globalThis.fetch = async (input, init) => {
              if (
                !failed &&
                String(input).endsWith('/api/collections/_superusers/auth-with-password')
              ) {
                failed = true;
                throw new Error('Synthetic restored-start failure');
              }
              return original(input, init);
            };
          });
        }
        const restored = await page.evaluate(
          (name) => globalThis.window.api.restoreBackup(name),
          name,
        );
        expect(restored.success).toBe(!failStartup);
        // Immediate reads: a 204 response or an old healthy process is not completion.
        await pb.collection('_superusers').authWithPassword('admin@relay.app', secret);
        expect((await pb.collection('contacts').getOne(contact.id)).name).toBe(
          failStartup ? 'After backup' : 'Before restore',
        );
        if (failStartup) {
          await expect(
            pb.collection('operator_custom_fixture').getOne(unknown.id),
          ).rejects.toMatchObject({ status: 404 });
        } else {
          expect((await pb.collection('operator_custom_fixture').getOne(unknown.id)).value).toBe(
            'Preserve me',
          );
        }
        expect(readFileSync(file, 'utf8')).toBe(failStartup ? 'Changed file' : 'Original file');
        expect(readFileSync(join(profile, 'data/pb_data/backups', name)).length).toBeGreaterThan(0);
      } finally {
        await app?.close();
        rmSync(profile, { recursive: true, force: true });
      }
    },
  );
