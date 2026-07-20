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

  it('keeps a desktop bottom gutter while preserving the mobile all-side gutter', () => {
    const root = ruleBody(css, '.knowledge-management');
    const mobileRoot = ruleBody(mediaBody(820), '.knowledge-management');

    expect(root).toContain(
      'padding: var(--space-4) var(--space-5) max(var(--space-5), env(safe-area-inset-bottom));',
    );
    expect(root).toContain('overflow: auto;');
    expect(mobileRoot).toContain(
      'padding: var(--space-3) var(--space-3) max(var(--space-3), env(safe-area-inset-bottom));',
    );
  });

  it('keeps content unclipped, actions wrapped, and one visible field focus ring', () => {
    const content = ruleBody(css, '.knowledge-management__content');
    const auditContent = ruleBody(css, '.knowledge-management__content--audit');
    const actions = ruleBody(css, '.knowledge-management-row__actions');
    const focus = ruleBody(css, '.knowledge-management :is(input, select, textarea):focus-visible');

    expect(content).toContain('overflow: visible;');
    expect(content).not.toContain('overflow: hidden;');
    expect(auditContent).toContain('overflow-y: auto;');
    expect(auditContent).toContain('overscroll-behavior: contain;');
    expect(actions).toContain('flex-wrap: wrap;');
    expect(focus).toContain('outline: 2px solid var(--accent-bright);');
    expect(focus).toContain('outline-offset: 1px;');
    expect(focus).toContain('box-shadow: none;');
    expect(css).not.toContain('.knowledge-management-grid');
  });

  it('contains search readiness and its focus fallback at full and narrow widths', () => {
    const searchGroup = ruleBody(css, '.knowledge-management-row__search');
    const readiness = ruleBody(css, '.knowledge-search-readiness');
    const retry = ruleBody(css, '.knowledge-search-readiness__retry.tactile-button--sm');
    const documentsHeading = ruleBody(css, '.knowledge-management-section-heading--documents');
    const documentsHeadingFocus = ruleBody(
      css,
      '.knowledge-management-section-heading--documents h2:focus-visible',
    );
    const searchableCount = ruleBody(css, '.knowledge-management__searchable-count');
    const narrowSearchGroup = ruleBody(mediaBody(560), '.knowledge-management-row__search');
    const narrowSearchableCount = ruleBody(
      mediaBody(560),
      '.knowledge-management__searchable-count',
    );

    expect(searchGroup).toContain('min-width: 0;');
    expect(searchGroup).toContain('flex-wrap: wrap;');
    expect(readiness).toContain('max-width: 100%;');
    expect(retry).toContain('min-height: 26px;');
    expect(documentsHeading).toContain('flex-wrap: wrap;');
    expect(searchableCount).toContain('white-space: nowrap;');
    expect(documentsHeadingFocus).toContain('outline: 2px solid var(--accent-bright);');
    expect(narrowSearchGroup).toContain('width: 100%;');
    expect(narrowSearchableCount).toContain('white-space: normal;');
  });

  it('wraps management header actions as one unit instead of orphaning a button', () => {
    const header = ruleBody(css, '.knowledge-management__header');
    const actions = ruleBody(css, '.knowledge-management__header-actions');

    expect(header).toContain('flex-wrap: wrap;');
    expect(actions).toContain('flex: 0 0 auto;');
    expect(actions).toContain('flex-wrap: nowrap;');
  });

  it('gives the document editor a full-width row with reachable actions', () => {
    const editingRow = ruleBody(
      css,
      '.knowledge-management-row:has(> .knowledge-management-row__editor)',
    );
    const editor = ruleBody(css, '.knowledge-management-row__editor');
    const eyebrow = ruleBody(css, '.knowledge-management-row__eyebrow');

    expect(editingRow).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(editor).toContain('grid-column: 1 / -1;');
    expect(eyebrow).toContain('display: flex;');
    expect(eyebrow).toContain('gap: var(--space-2);');
  });

  it('uses flat selection, opaque tools, square controls, and compact rows', () => {
    const railButton = ruleBody(css, '.knowledge-management__rail button');
    const activeRailButton = ruleBody(css, '.knowledge-management__rail button.is-active');
    const count = ruleBody(css, '.knowledge-management__rail strong');
    const role = ruleBody(css, '.knowledge-management__role');
    const toolbar = ruleBody(css, '.knowledge-management__toolbar');
    const controls = ruleBody(css, '.knowledge-management :is(input, select, textarea)');
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
    expect(title).toContain('font-size: var(--text-md);');
    expect(status).toContain('border-radius: 2px;');
  });

  it('keeps upload queue emphasis flat and scoped', () => {
    const summary = ruleBody(css, '.knowledge-upload-queue__summary');

    expect(summary).toContain('background: var(--accent-subtle);');
    expect(summary).not.toContain('linear-gradient');
  });

  it('uses outlined danger for entry actions without weakening confirmation danger', () => {
    const outline = ruleBody(
      css,
      '.knowledge-management .tactile-button--danger.knowledge-management__danger-outline',
    );
    const outlineHover = ruleBody(
      css,
      '.knowledge-management .tactile-button--danger.knowledge-management__danger-outline:hover',
    );
    const outlineDisabledHover = ruleBody(
      css,
      '.knowledge-management .tactile-button--danger.knowledge-management__danger-outline:disabled:hover',
    );

    expect(outline).toContain('border-color: var(--alarm);');
    expect(outline).toContain('color: var(--alarm-bright);');
    expect(outline).toContain('background: transparent;');
    expect(outlineHover).toContain('background: var(--alarm-dim);');
    expect(outlineDisabledHover).toContain('background: transparent;');
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
    expect(railButton1100).toContain('flex: 1 0 160px;');
    expect(uploadFile1100).toContain('gap: var(--space-4);');
    expect(toolbar820).toContain('position: static;');
    expect(toolbar820).toContain('align-items: stretch;');
    expect(toolbar820).toContain('flex-direction: column;');
    expect(rail560).toContain('overflow-x: auto;');
    expect(railButton560).toContain('min-height: 44px;');
    expect(railButton560).toContain('flex: 0 0 auto;');
    expect(railButton560).toContain('min-width: 160px;');
    expect(railButton560).toContain('padding: 0 var(--space-3);');
    expect(railLabel560).toContain('font-size: var(--text-sm);');
    expect(mediaBody(560)).not.toContain('span::first-letter');
  });

  it('uses the shared semantic type hierarchy for management content', () => {
    const mapping = [
      [
        '.knowledge-management__role,\n.knowledge-management-status,\n.knowledge-management-row__type',
        '2xs',
      ],
      ['.knowledge-management__header p', 'base'],
      ['.knowledge-management__feedback,\n.knowledge-management__recovery', 'base'],
      ['.knowledge-management__rail button', 'sm'],
      [
        '.knowledge-management__search,\n.knowledge-management-row__editor label,\n.knowledge-management-row__delete label',
        '2xs',
      ],
      ['.knowledge-management :is(input, select, textarea)', 'sm'],
      ['.knowledge-management-row__identity h2,\n.knowledge-audit-row h2', 'md'],
      ['.knowledge-management-row__meta', 'xs'],
      ['.knowledge-upload-queue__summary h2,\n.knowledge-management-section-heading h2', 'lg'],
      ['.knowledge-upload-file__state strong', 'sm'],
      ['.knowledge-management-empty', 'base'],
    ] as const;

    mapping.forEach(([selector, token]) => {
      expect(ruleBody(css, selector), selector).toContain('font-size: var(--text-' + token + ');');
    });
    expect(ruleBody(css, '.knowledge-management :is(input, select, textarea)')).toContain(
      'font-family: var(--font-family-base);',
    );
  });
});
