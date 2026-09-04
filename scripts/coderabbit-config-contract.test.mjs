import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const configPath = '.coderabbit.yaml';
const developmentPath = 'docs/DEVELOPMENT.md';
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
  it('keeps CodeRabbit honest as an explicitly requested review', () => {
    expect(existsSync(configPath)).toBe(true);

    const config = parse(readFileSync(configPath, 'utf8'));

    expect(config).toMatchObject({
      reviews: {
        request_changes_workflow: true,
        auto_review: {
          enabled: false,
          drafts: false,
          base_branches: ['main'],
        },
        tools: {
          'github-checks': {
            enabled: true,
            timeout_ms: 900_000,
          },
        },
      },
    });
    expect(config.reviews.auto_review).toEqual({
      enabled: false,
      drafts: false,
      base_branches: ['main'],
    });
    expect(collectKeys(config).filter((key) => PAID_SETTING.test(key))).toEqual([]);
    expect(readFileSync(developmentPath, 'utf8')).toContain('@coderabbitai review');
  });
});
