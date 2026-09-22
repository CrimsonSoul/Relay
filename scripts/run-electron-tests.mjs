#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectronTests } from './electron-test-runner.mjs';
import { writeElectronShard } from './plan-electron-shards.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
const electronRebuild = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const playwright = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

const args = process.argv.slice(2);
const balanced = args.filter((arg) => arg.startsWith('--balanced-shard='));
if (balanced.length > 1) throw new Error('Specify one balanced Electron shard.');
const directory = balanced.length ? mkdtempSync(join(tmpdir(), 'relay-electron-shard-')) : null;
try {
  const playwrightArgs = args.filter((arg) => !arg.startsWith('--balanced-shard='));
  if (directory) {
    // npm run test:electron builds first: discovery imports emitted CSS assets.
    const list = join(directory, 'tests.txt');
    writeElectronShard(balanced[0].slice('--balanced-shard='.length), list);
    playwrightArgs.push(`--test-list=${list}`);
  }
  process.exitCode = runElectronTests({
    electronVersion,
    electronRebuildPath: electronRebuild,
    playwrightPath: playwright,
    npmExecPath: process.env.npm_execpath,
    nodePath: process.execPath,
    playwrightArgs,
    cwd: root,
    env: process.env,
  });
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
