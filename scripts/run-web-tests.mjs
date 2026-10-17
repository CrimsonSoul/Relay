#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectronTests } from './electron-test-runner.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electronVersion = JSON.parse(
  readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;

process.exitCode = runElectronTests({
  electronVersion,
  electronRebuildPath: join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
  playwrightPath: join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
  playwrightConfigPath: 'playwright.web.config.ts',
  playwrightArgs: process.argv.slice(2),
  npmExecPath: process.env.npm_execpath,
  nodePath: process.execPath,
  cwd: root,
  // Unpackaged Relay launches muted under test (src/main/index.ts), so runs make no sound.
  env: { ...process.env, RELAY_TEST_MUTE_AUDIO: '1' },
});
