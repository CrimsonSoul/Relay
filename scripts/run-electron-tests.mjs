#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
const electronRebuild = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const playwright = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
};

let exitCode = 1;

try {
  process.stdout.write(`Rebuilding better-sqlite3 for Electron ${electronVersion}...\n`);
  exitCode = run(process.execPath, [
    electronRebuild,
    '--force',
    '--which-module',
    'better-sqlite3',
    '--version',
    electronVersion,
  ]);

  if (exitCode === 0) {
    exitCode = run(process.execPath, [
      playwright,
      'test',
      '-c',
      'playwright.electron.config.ts',
      ...process.argv.slice(2),
    ]);
  }
} finally {
  process.stdout.write('Restoring better-sqlite3 for the current Node ABI...\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const restoreExitCode = run(npm, ['rebuild', 'better-sqlite3', '--build-from-source']);

  if (restoreExitCode !== 0) {
    exitCode = restoreExitCode;
  }
}

process.exitCode = exitCode;
