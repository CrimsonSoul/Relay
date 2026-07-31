import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const configPath = '.coderabbit.yaml';
const PAID_SETTING = /(?:usage|credit|billing|overage|paid)/iu;

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe('CodeRabbit review contract', () => {
  it('automatically reviews test pull requests after GitHub quality checks finish', () => {
    expect(existsSync(configPath)).toBe(true);

    const config = parse(readFileSync(configPath, 'utf8'));

    expect(config).toMatchObject({
      reviews: {
        request_changes_workflow: true,
        auto_review: {
          enabled: true,
          drafts: false,
          auto_incremental_review: true,
          auto_pause_after_reviewed_commits: 2,
          base_branches: ['test'],
        },
        tools: {
          'github-checks': {
            enabled: true,
            timeout_ms: 900_000,
          },
        },
      },
    });
    expect(collectKeys(config).filter((key) => PAID_SETTING.test(key))).toEqual([]);
  });
});
