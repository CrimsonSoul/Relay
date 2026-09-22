import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { balanceTests, inventoryFromReport } from './plan-electron-shards.mjs';

const spec = (title, projectName = '') => ({
  file: 'example.spec.ts',
  title,
  tests: [{ projectName }],
});
const report = (specs, suites = []) => ({
  errors: [],
  suites: [{ title: 'example.spec.ts', specs, suites }],
});

describe('duration-balanced Electron shards', () => {
  it('selects the full real Playwright suite exactly once across all generated lists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-shards-'));
    const list = (extra = []) =>
      inventoryFromReport(
        JSON.parse(
          execFileSync(
            process.execPath,
            [
              'node_modules/@playwright/test/cli.js',
              'test',
              '-c',
              'playwright.electron.config.ts',
              '--list',
              '--reporter=json',
              ...extra,
            ],
            { encoding: 'utf8' },
          ),
        ),
      );
    try {
      const full = list();
      const selected = [];
      for (let index = 1; index <= 4; index += 1) {
        const path = join(directory, `shard-${index}.txt`);
        execFileSync(process.execPath, ['scripts/plan-electron-shards.mjs', `${index}/4`, path]);
        const actual = list([`--test-list=${path}`]);
        expect(actual.sort()).toEqual(readFileSync(path, 'utf8').trim().split('\n').sort());
        selected.push(...actual);
      }
      expect(selected.sort()).toEqual(full.sort());
      expect(new Set(selected).size).toBe(full.length);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('assigns every discovered test exactly once, including new and renamed tests', () => {
    const inventory = inventoryFromReport(
      report(
        [spec('slow'), spec('medium'), spec('new')],
        [{ title: 'nested', specs: [spec('renamed')] }],
      ),
    );
    const shards = balanceTests(
      inventory,
      { [inventory[0]]: 100, [inventory[1]]: 50, deleted: 900 },
      2,
    );
    expect(shards.flatMap((shard) => shard.tests).sort()).toEqual([...inventory].sort());
    expect(shards.map((shard) => shard.seconds)).toEqual([100, 110]);
    expect(inventory[3]).toBe('[] › example.spec.ts › nested › renamed');
    expect(
      balanceTests([...inventory].reverse(), { [inventory[0]]: 100, [inventory[1]]: 50 }, 2),
    ).toEqual(shards);
  });

  it('keeps projects distinct and never omits skipped tests from discovery', () => {
    const input = report([spec('same', 'one'), spec('same', 'two')]);
    input.suites[0].specs[0].tests[0].expectedStatus = 'skipped';
    expect(inventoryFromReport(input)).toEqual([
      '[one] › example.spec.ts › same',
      '[two] › example.spec.ts › same',
    ]);
  });

  it.each([
    { errors: ['load failed'], suites: [] },
    report([]),
    report([spec('duplicate'), spec('duplicate')]),
    report([spec('title › delimiter')]),
    report([spec('multiline\ntitle')]),
    report([spec('prefix')], [{ title: 'prefix', specs: [spec('child')] }]),
  ])('rejects broken or ambiguous discovery rather than silently dropping tests', (input) => {
    expect(() => inventoryFromReport(input)).toThrow();
  });

  it('rejects invalid shard counts and invalid timing data', () => {
    for (const count of [0, 3, 1.5]) expect(() => balanceTests(['a', 'b'], {}, count)).toThrow();
    for (const seconds of [0, -1, NaN, Infinity])
      expect(() => balanceTests(['a'], { a: seconds }, 1)).toThrow();
  });
});
