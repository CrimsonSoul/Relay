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
    expect(ruleBody('.personnel-alert')).toContain(
      'height: var(--tab-command-control-height, 36px)',
    );
  });

  it('keeps on-call role codes and shift windows at or above the 13px type floor', () => {
    const root = ruleBody('.personnel-tab-root');
    expect(root).toContain('--oncall-role-code-font-size: clamp(var(--text-2xs),');
    expect(root).toContain('--oncall-secondary-font-size: clamp(var(--text-2xs),');
    expect(root).toContain('--oncall-badge-font-size: clamp(var(--text-2xs),');
    expect(css).not.toMatch(/clamp\(1[0-2]px/);
  });

  it('scales team headers and health badges with the board font scale', () => {
    // Anchored to a line start: `.team-card-body:has(...) .team-card-name` comes first in the file.
    expect(ruleBody('\n.team-card-name')).toContain('var(--oncall-header-font-size');
    expect(ruleBody('.team-health-badge')).toContain('var(--oncall-badge-font-size');
  });

  it('keeps role codes and the healthy badge in neutral ink, never accent or status colour', () => {
    for (const selector of [
      '.team-row-role-code--primary',
      '.team-row-role-code--backup',
      '.team-health-badge--ok',
    ]) {
      expect(ruleBody(selector)).not.toMatch(/--accent|--ok|--color-warning|--alarm/);
    }
  });
});
