import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const configPath = '.coderabbit.yaml';

describe('CodeRabbit review contract', () => {
  it('automatically reviews test pull requests after GitHub quality checks finish', () => {
    expect(existsSync(configPath)).toBe(true);

    const config = parse(readFileSync(configPath, 'utf8'));

    expect(config).toMatchObject({
      reviews: {
        auto_review: {
          enabled: true,
          drafts: false,
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
  });
});
