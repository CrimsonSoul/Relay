#!/usr/bin/env node
/**
 * Real typecheck with a ratchet.
 *
 * `tsc --noEmit` at the repo root checked NOTHING: the root tsconfig is
 * solution-style (`files: []` + references), and without `-b` tsc walks no
 * project. The gate was green in CI and in the pre-commit hook while ~1800
 * errors sat unreported — which is how an `app.on('session-end')` listener that
 * can never fire reached main.
 *
 * Checking both projects for real reports far too many errors to fix in one
 * go, so this ratchets instead: the build fails when the count goes UP, or when
 * a file that was previously clean starts reporting errors. Paying the debt
 * down is then a matter of lowering the recorded baseline.
 *
 *   node scripts/typecheck.mjs            # verify against the baseline
 *   node scripts/typecheck.mjs --update   # re-record after fixing errors
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baselinePath = join(root, 'scripts', 'typecheck-baseline.json');
const projects = ['tsconfig.node.json', 'tsconfig.renderer.json'];

/** Count errors per file for one project. */
function check(project) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project, '--noEmit'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const perFile = {};
  for (const line of output.split('\n')) {
    const match = /^(?<file>[^(]+)\(\d+,\d+\): error TS\d+/.exec(line);
    if (match?.groups) {
      const file = match.groups.file.replaceAll('\\', '/');
      perFile[file] = (perFile[file] ?? 0) + 1;
    }
  }
  return perFile;
}

const current = {};
for (const project of projects) Object.assign(current, check(project));
const total = Object.values(current).reduce((sum, n) => sum + n, 0);

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, `${JSON.stringify({ total, perFile: current }, null, 2)}\n`);
  console.log(`Recorded typecheck baseline: ${total} errors across ${Object.keys(current).length} files.`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error('No typecheck baseline recorded. Run: node scripts/typecheck.mjs --update');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const regressions = [];
for (const [file, count] of Object.entries(current)) {
  const before = baseline.perFile[file] ?? 0;
  if (count > before) regressions.push(`${file}: ${before} -> ${count}`);
}

if (regressions.length > 0) {
  console.error(`Typecheck regressed in ${regressions.length} file(s):\n  ${regressions.join('\n  ')}`);
  console.error(
    '\nFix the new errors. If a file legitimately grew, re-record with: node scripts/typecheck.mjs --update',
  );
  process.exit(1);
}

const improvement = baseline.total - total;
console.log(
  improvement > 0
    ? `Typecheck OK — ${total} known errors (${improvement} fewer than baseline; re-record to lock it in).`
    : `Typecheck OK — ${total} known errors, none new.`,
);
