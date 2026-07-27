#!/usr/bin/env node

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * NODE_OPTIONS is split on whitespace, so an unquoted path containing a space
 * silently truncates the option value: Node then writes the localStorage file
 * to the wrong location and the cleanup below removes nothing. Node's
 * NODE_OPTIONS parser understands double quotes, so quote the value.
 */
export function composeNodeOptions(existingNodeOptions, localStorageFile) {
  if (localStorageFile.includes('"')) {
    throw new Error(`Renderer localStorage path must not contain a quote: ${localStorageFile}`);
  }
  return [existingNodeOptions?.trim(), `--localstorage-file="${localStorageFile}"`]
    .filter(Boolean)
    .join(' ');
}

function runRendererTests() {
  const tempDir = join(root, 'tmp');
  const localStorageFile = join(tempDir, `vitest-localstorage-${process.pid}.json`);

  mkdirSync(tempDir, { recursive: true });

  const cleanup = () => rmSync(localStorageFile, { force: true });

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
        NODE_OPTIONS: composeNodeOptions(process.env.NODE_OPTIONS, localStorageFile),
      },
      stdio: 'inherit',
    },
  );

  child.on('error', (error) => {
    cleanup();
    process.stderr.write(`Renderer tests could not start: ${error.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRendererTests();
}
