import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)?.[1] ?? '';
}

function mediaBody(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  const end = css.indexOf('@media ', start + 1);
  return css.slice(start, end === -1 ? css.length : end);
}

describe('Knowledge Management visual system', () => {
  it('uses the flat operational shell and shared heading rhythm', () => {
    const root = ruleBody(css, '.knowledge-management');
    const header = ruleBody(css, '.knowledge-management__header');
    const title = ruleBody(css, '.knowledge-management__header h1');
    const workspace = ruleBody(css, '.knowledge-management__workspace');

    expect(root).toContain('gap: var(--space-4);');
    expect(root).toContain('padding: var(--space-4) var(--space-5) 0;');
    expect(root).toContain('background: var(--color-bg-app);');
    expect(root).not.toContain('linear-gradient');
    expect(header).toContain('gap: var(--space-5);');
    expect(header).toContain('padding: 0;');
    expect(title).toContain('margin: var(--space-1) 0 0;');
    expect(title).toContain('font-size: var(--text-2xl);');
    expect(title).toContain('letter-spacing: 0;');
    expect(title).toContain('line-height: var(--leading-tight);');
    expect(workspace).toContain('grid-template-columns: 190px minmax(0, 1fr);');
    expect(workspace).toContain('margin-top: 0;');
    expect(workspace).toContain('box-shadow: none;');
  });

  it('uses flat selection, opaque tools, square controls, and compact rows', () => {
    const railButton = ruleBody(css, '.knowledge-management__rail button');
    const activeRailButton = ruleBody(css, '.knowledge-management__rail button.is-active');
    const count = ruleBody(css, '.knowledge-management__rail strong');
    const role = ruleBody(css, '.knowledge-management__role');
    const toolbar = ruleBody(css, '.knowledge-management__toolbar');
    const controls = ruleBody(css, '.knowledge-management :is(input, select)');
    const categoryTool = ruleBody(css, '.knowledge-management__category-tool');
    const row = ruleBody(css, '.knowledge-management-row');
    const title = ruleBody(css, '.knowledge-management-row__identity h2,\n.knowledge-audit-row h2');
    const status = ruleBody(css, '.knowledge-management-status');

    expect(railButton).toContain('border: 1px solid transparent;');
    expect(railButton).toContain('border-radius: 2px;');
    expect(activeRailButton).toContain('border-color: var(--color-border-accent);');
    expect(activeRailButton).toContain('background: var(--accent-subtle);');
    expect(activeRailButton).not.toContain('linear-gradient');
    expect(count).toContain('border-radius: 2px;');
    expect(role).toContain('border-radius: 2px;');
    expect(toolbar).toContain('gap: var(--space-4);');
    expect(toolbar).toContain('padding: var(--space-3) var(--space-4);');
    expect(toolbar).toContain('background: var(--color-bg-surface);');
    expect(toolbar).toContain('backdrop-filter: none;');
    expect(controls).toContain('height: 40px;');
    expect(controls).toContain('border-radius: 2px;');
    expect(categoryTool).toContain('gap: var(--space-2);');
    expect(row).toContain('gap: var(--space-4);');
    expect(row).toContain('min-height: 84px;');
    expect(row).toContain('padding: var(--space-3) var(--space-4);');
    expect(title).toContain('font-size: var(--text-sm);');
    expect(status).toContain('border-radius: 2px;');
  });

  it('keeps upload queue emphasis flat and scoped', () => {
    const summary = ruleBody(css, '.knowledge-upload-queue__summary');

    expect(summary).toContain('background: var(--accent-subtle);');
    expect(summary).not.toContain('linear-gradient');
  });

  it('preserves readable section labels and stacked tools at each breakpoint', () => {
    const rail1100 = ruleBody(mediaBody(1100), '.knowledge-management__rail');
    const railButton1100 = ruleBody(mediaBody(1100), '.knowledge-management__rail button');
    const uploadFile1100 = ruleBody(mediaBody(1100), '.knowledge-upload-file');
    const toolbar820 = ruleBody(mediaBody(820), '.knowledge-management__toolbar');
    const rail560 = ruleBody(mediaBody(560), '.knowledge-management__rail');
    const railButton560 = ruleBody(mediaBody(560), '.knowledge-management__rail button');
    const railLabel560 = ruleBody(mediaBody(560), '.knowledge-management__rail button span');

    expect(rail1100).toContain('overflow-x: auto;');
    expect(rail1100).toContain('flex-direction: row;');
    expect(rail1100).toContain('gap: var(--space-2);');
    expect(rail1100).toContain('padding: var(--space-2);');
    expect(railButton1100).toContain('min-height: 44px;');
    expect(railButton1100).toContain('flex: 1 0 132px;');
    expect(uploadFile1100).toContain('gap: var(--space-4);');
    expect(toolbar820).toContain('position: static;');
    expect(toolbar820).toContain('align-items: stretch;');
    expect(toolbar820).toContain('flex-direction: column;');
    expect(rail560).toContain('overflow-x: auto;');
    expect(railButton560).toContain('min-height: 44px;');
    expect(railButton560).toContain('flex: 0 0 auto;');
    expect(railButton560).toContain('min-width: 132px;');
    expect(railButton560).toContain('padding: 0 var(--space-3);');
    expect(railLabel560).toContain('font-size: 10px;');
    expect(mediaBody(560)).not.toContain('span::first-letter');
  });
});
