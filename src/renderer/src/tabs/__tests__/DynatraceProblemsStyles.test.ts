import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/tabs/dynatrace-problems.css'),
  'utf8',
);

describe('Dynatrace local disposition styling', () => {
  it('uses informational blue for Addressed locally', () => {
    const block = /\.dt-problem-badge--addressed\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(block).toContain('border-color: var(--info)');
    expect(block).toContain('var(--info) 12%');
    expect(block).toContain('color: var(--info-bright)');
  });
});
