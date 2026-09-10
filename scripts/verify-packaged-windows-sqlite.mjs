import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options } from '@electron/fuses';
import { FuseState } from '@electron/fuses/dist/constants.js';

if (process.platform !== 'win32') throw new Error('Packaged SQLite loading requires Windows.');
const packageRoot = resolve(process.argv[2] || 'release/win-unpacked');
const directory = mkdtempSync(join(tmpdir(), 'relay-packaged-sqlite-'));
try {
  // The shipped executable deliberately disables RunAsNode. Modify only an isolated copy.
  const copiedPackage = join(directory, 'package');
  cpSync(packageRoot, copiedPackage, { recursive: true });
  const copiedExecutable = join(copiedPackage, 'Relay.exe');
  await flipFuses(copiedExecutable, { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: true });
  const fuses = await getCurrentFuseWire(copiedExecutable);
  if (fuses[FuseV1Options.RunAsNode] !== FuseState.ENABLE) {
    throw new Error('Disposable Electron copy did not enable RunAsNode; refusing to launch.');
  }
  const profile = join(directory, 'profile');
  mkdirSync(profile);
  const output = execFileSync(
    copiedExecutable,
    [
      '-e',
      `const Database = require(process.argv[1]);
     const db = new Database(':memory:');
     if (db.prepare('SELECT 42 AS answer').get().answer !== 42) throw new Error('SQLite result mismatch');
     db.close(); process.stdout.write('packaged-sqlite-ok');`,
      join(copiedPackage, 'resources', 'app.asar', 'node_modules', 'better-sqlite3'),
    ],
    {
      cwd: directory,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', APPDATA: profile, LOCALAPPDATA: profile },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  if (!output.includes('packaged-sqlite-ok'))
    throw new Error('Packaged SQLite verification did not complete.');
  console.log('Packaged Electron loaded better-sqlite3 and executed an in-memory query.');
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
