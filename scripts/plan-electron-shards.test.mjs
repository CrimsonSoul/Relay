import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { balanceTests, inventoryFromReport, writeElectronShard } from './plan-electron-shards.mjs';

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
  it('does not expose file writes through command-line arguments', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-shard-cli-'));
    const file = join(directory, 'existing.txt');
    try {
      writeFileSync(file, 'preserve this file');
      execFileSync(process.execPath, ['scripts/plan-electron-shards.mjs', '1/1', file]);
      expect(readFileSync(file, 'utf8')).toBe('preserve this file');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('selects every test with real Playwright, including projects and skips, without app build artifacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relay-shards-'));
    const configPath = join(directory, 'playwright.config.cjs');
    writeFileSync(
      configPath,
      `module.exports = {testDir: __dirname, testMatch: '**/*.spec.cjs', projects: [{name: 'one'}, {name: 'two'}]};`,
    );
    const playwrightModule = fileURLToPath(
      new URL('../node_modules/@playwright/test/index.js', import.meta.url),
    );
    writeFileSync(
      join(directory, 'example.spec.cjs'),
      `
      const { test } = require(${JSON.stringify(playwrightModule)});
      test('first', () => {});
      test.skip('skipped', () => {});
      test.describe('nested', () => {
        for (let index = 0; index < 4; index++) test('case ' + index, () => {});
      });
    `,
    );
    const list = (extra = []) =>
      inventoryFromReport(
        JSON.parse(
          execFileSync(
            process.execPath,
            [
              'node_modules/@playwright/test/cli.js',
              'test',
              '-c',
              configPath,
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
      expect(full).toHaveLength(12);
      const selected = [];
      for (let index = 1; index <= 4; index += 1) {
        const path = join(directory, `shard-${index}.txt`);
        writeElectronShard(`${index}/4`, path, configPath);
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
