#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectronTests } from './electron-test-runner.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
const electronRebuild = join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const playwright = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

process.exitCode = runElectronTests({
  electronVersion,
  electronRebuildPath: electronRebuild,
  playwrightPath: playwright,
  npmExecPath: process.env.npm_execpath,
  nodePath: process.execPath,
  playwrightArgs: process.argv.slice(2),
  cwd: root,
  env: process.env,
});
