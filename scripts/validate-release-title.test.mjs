import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const validator = path.resolve(import.meta.dirname, 'validate-release-title.mjs');

function validate(title) {
  return spawnSync(process.execPath, [validator], {
    encoding: 'utf8',
    env: { ...process.env, RELAY_PULL_REQUEST_TITLE: title },
  });
}

describe('release-compatible pull request titles', () => {
  it.each([
    'fix(updater): restore automatic installation',
    'feat(release): add retained-build recovery',
    'docs: clarify release behavior',
  ])('accepts conventional squash title %s', (title) => {
    const result = validate(title);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Release-compatible pull request title: ${title}`);
  });

  it.each(['Fix updater installation fallback', 'add updater fallback', 'fix: ', ''])(
    'rejects non-conventional squash title %s',
    (title) => {
      const result = validate(title);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Pull request title must use Conventional Commits syntax');
    },
  );
});
