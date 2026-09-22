import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function clearElectronRebuildMetadata(moduleDirectory) {
  // prebuild-install replaces the binding without removing Electron's ABI marker.
  // Leaving it behind makes electron-builder skip the next required rebuild.
  for (const buildType of ['Release', 'Debug']) {
    rmSync(join(moduleDirectory, 'build', buildType, '.forge-meta'), { force: true });
  }
}

function verifyHostSqlite() {
  // A fresh Node process must load the restored binary, not a previously loaded
  // binding. Keep the probe independent of Relay's application data.
  const database = new Database(':memory:');
  try {
    const result = database.prepare('SELECT 1 AS ok').get();
    if (result?.ok !== 1) throw new Error('Host SQLite verification query failed');
  } finally {
    database.close();
  }
  const require = createRequire(import.meta.url);
  clearElectronRebuildMetadata(dirname(require.resolve('better-sqlite3/package.json')));
  console.log(`Verified better-sqlite3 for Node ABI ${process.versions.modules}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHostSqlite();
}
