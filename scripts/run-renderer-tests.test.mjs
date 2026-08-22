import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeNodeOptions } from './run-renderer-tests.mjs';

const created = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

describe('composeNodeOptions', () => {
  it('quotes the localStorage path so a directory containing a space survives', () => {
    expect(composeNodeOptions(undefined, '/relay checkout/tmp/ls.json')).toBe(
      '--localstorage-file="/relay checkout/tmp/ls.json"',
    );
  });

  it('preserves pre-existing NODE_OPTIONS', () => {
    expect(composeNodeOptions('  --max-old-space-size=4096 ', '/relay/tmp/ls.json')).toBe(
      '--max-old-space-size=4096 --localstorage-file="/relay/tmp/ls.json"',
    );
  });

  it('rejects a path that would break the quoting', () => {
    expect(() => composeNodeOptions(undefined, '/relay/"tmp"/ls.json')).toThrow(/quote/i);
  });

  it('directs Node at the intended file even when the path contains a space', () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'relay-renderer-opts-'));
    created.push(workRoot);
    const spaced = join(workRoot, 'relay checkout');
    mkdirSync(spaced, { recursive: true });
    const target = join(spaced, 'ls.json');

    const result = spawnSync(
      process.execPath,
      ['--experimental-webstorage', '-e', 'globalThis.localStorage.setItem("relay", "ok");'],
      {
        cwd: workRoot,
        env: { ...process.env, NODE_OPTIONS: composeNodeOptions(undefined, target) },
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(existsSync(target)).toBe(true);
    // The truncated form would have created a sibling named after the first path segment.
    expect(readdirSync(workRoot)).toEqual(['relay checkout']);
  });
});
