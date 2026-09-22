import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compare = (a, b) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

// Always discover the current suite. Timings affect placement only; a renamed or
// newly added test receives a conservative estimate and still runs exactly once.
export function inventoryFromReport(report) {
  if (!Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length) {
    throw new Error('Electron test discovery failed.');
  }
  const inventory = [];
  function visit(suite, titles) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const parts = [spec.file, ...titles, spec.title];
        if (
          parts.some((part) => typeof part !== 'string' || !part.trim() || /[\r\n›]/u.test(part)) ||
          typeof test.projectName !== 'string' ||
          /[\r\n›[\]]/u.test(test.projectName)
        ) {
          throw new Error('Unsupported Electron test-list identifier.');
        }
        inventory.push(`[${test.projectName}] › ${parts.join(' › ')}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
  }
  for (const suite of report.suites) visit(suite, []);
  if (!inventory.length || new Set(inventory).size !== inventory.length) {
    throw new Error('Electron test inventory must be nonempty and unique.');
  }
  // Playwright test lists match title prefixes. Reject overlapping identifiers
  // instead of accidentally executing a test in two different shards.
  const ordered = [...inventory].sort(compare);
  if (ordered.some((id, index) => index > 0 && id.startsWith(`${ordered[index - 1]} › `))) {
    throw new Error('Electron test-list identifiers overlap.');
  }
  return inventory;
}

export function balanceTests(inventory, durations, count) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > inventory.length ||
    new Set(inventory).size !== inventory.length
  ) {
    throw new Error('Invalid Electron shard count or inventory.');
  }
  const weighted = inventory
    .map((id) => {
      const seconds = Object.hasOwn(durations, id) ? durations[id] : 30;
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid duration: ${id}.`);
      return { id, seconds };
    })
    .sort((a, b) => b.seconds - a.seconds || compare(a.id, b.id));
  const shards = Array.from({ length: count }, () => ({ tests: [], seconds: 0 }));
  for (const test of weighted) {
    const shard = shards.reduce((best, candidate) =>
      candidate.seconds < best.seconds ? candidate : best,
    );
    shard.tests.push(test.id);
    shard.seconds += test.seconds;
  }
  for (const shard of shards) shard.tests.sort(compare);
  return shards;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , selection, output] = process.argv;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(selection ?? '');
  if (!match || !output || Number(match[1]) > Number(match[2])) {
    throw new Error('Usage: node scripts/plan-electron-shards.mjs INDEX/TOTAL OUTPUT');
  }
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '-c',
      'playwright.electron.config.ts',
      '--list',
      '--reporter=json',
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `Electron test discovery failed: ${result.stderr || result.error || result.signal}`,
    );
  }
  const inventory = inventoryFromReport(JSON.parse(result.stdout));
  const { durations } = JSON.parse(
    readFileSync(new URL('./electron-test-durations.json', import.meta.url), 'utf8'),
  );
  const shards = balanceTests(inventory, durations, Number(match[2]));
  writeFileSync(output, `${shards[Number(match[1]) - 1].tests.join('\n')}\n`);
  console.log(
    `Discovered ${inventory.length} tests; shard ${selection} selects ${shards[Number(match[1]) - 1].tests.length}.`,
  );
  console.log(
    `Estimated test seconds per shard: ${shards.map((shard) => Math.round(shard.seconds)).join(', ')} (excludes setup).`,
  );
}
