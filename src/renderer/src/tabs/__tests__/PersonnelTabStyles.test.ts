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
  it('matches the standard tab header and command-bar hierarchy', () => {
    expect(ruleBody('.personnel-tab-root')).toContain('gap: var(--space-4)');
    expect(ruleBody('.oncall-page-header')).toContain('justify-content: space-between');
    expect(ruleBody('.oncall-page-title')).toContain('font-size: var(--text-2xl)');

    const commandHeader = ruleBody('.oncall-command-bar .collapsible-header');
    expect(commandHeader).toContain('padding: 0');
    expect(commandHeader).toContain('border-bottom: 0');

    const actions = ruleBody('.oncall-command-bar .collapsible-header-actions');
    expect(actions).toContain('width: 100%');
    expect(actions).toContain('justify-content: space-between');
  });

  it('uses the same compact tactile button rhythm as the other tab toolbars', () => {
    const utilityButton = ruleBody('.oncall-command-action.tactile-button');
    expect(utilityButton).toContain('height: 36px');
    expect(utilityButton).toContain('padding: 0 var(--space-3)');
    expect(utilityButton).toContain('font-size: var(--text-xs)');
    expect(ruleBody('.oncall-font-scale-control')).toContain('height: 36px');
  });

  it('keeps both command groups usable at narrow desktop widths', () => {
    expect(css).toMatch(
      /@media \(max-width: 1120px\)[\s\S]*?\.oncall-command-bar \.collapsible-header-actions\s*\{[^}]*flex-direction:\s*column;[^}]*\}[\s\S]*?\.oncall-command-group--workflow\s*\{[^}]*justify-content:\s*flex-start;/,
    );
  });
});
