#!/usr/bin/env node
/** Run both TypeScript projects and fail if either compiler does not succeed. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultProjects = ['tsconfig.node.json', 'tsconfig.renderer.json'];
const tscPath = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * Run TypeScript against every configured project.
 *
 * @returns {{ ok: boolean }} true only when each compiler process exits with status 0.
 */
export function runTypecheck({
  projects = defaultProjects,
  spawn = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let ok = true;

  for (const project of projects) {
    const result = spawn(process.execPath, [tscPath, '-p', project, '--noEmit'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    stdout.write(result.stdout ?? '');
    stderr.write(result.stderr ?? '');

    if (result.error) {
      stderr.write(`Typecheck could not start for ${project}: ${result.error.message}\n`);
      ok = false;
    }
    if (result.signal) {
      stderr.write(`Typecheck was terminated for ${project} by ${result.signal}.\n`);
      ok = false;
    }
    if (result.status !== 0) {
      stderr.write(`Typecheck failed for ${project} with status ${result.status}.\n`);
      ok = false;
    }
  }

  return { ok };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runTypecheck().ok ? 0 : 1;
}
