import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/oncall/oncall.css'),
  'utf8',
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

describe('On-Call command bar styling', () => {
  it('keeps the board content on the shared top-level rhythm', () => {
    expect(ruleBody('.personnel-tab-root')).toContain('gap: var(--space-4)');
  });

  it('lets specialized utility controls inherit the shared command height', () => {
    expect(ruleBody('.oncall-font-scale-control')).toContain(
      'height: var(--tab-command-control-height, 36px)',
    );
    expect(ruleBody('.personnel-alert-btn')).toContain(
      'height: var(--tab-command-control-height, 36px)',
    );
  });
});
