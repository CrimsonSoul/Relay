#!/usr/bin/env node

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = join(root, 'tmp');
const localStorageFile = join(tempDir, `vitest-localstorage-${process.pid}.json`);

mkdirSync(tempDir, { recursive: true });

const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
const nodeOptions = [
  existingNodeOptions,
  `--localstorage-file=${localStorageFile}`,
].filter(Boolean).join(' ');

const child = spawn(
  process.execPath,
  [
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    '-c',
    'vitest.renderer.config.ts',
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    },
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  rmSync(localStorageFile, { force: true });
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
