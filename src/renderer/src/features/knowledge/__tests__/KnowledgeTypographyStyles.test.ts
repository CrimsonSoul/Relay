import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const knowledgeCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);
const workspaceCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledgeWorkspace.css'),
  'utf8',
);
const directoryCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/directory/directory.css'),
  'utf8',
);

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  return new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'm').exec(source)?.[1] ?? '';
}

function ruleBodies(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  return Array.from(source.matchAll(new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'gm')))
    .map((match) => match[1])
    .join('\n');
}

function expectFont(source: string, selector: string, token: string): void {
  expect(ruleBody(source, selector), selector).toContain('font-size: var(--text-' + token + ');');
}

describe('Knowledge and directory semantic typography', () => {
  it('uses the dual-distance scale on the splash and navigation', () => {
    expectFont(workspaceCss, '.knowledge-home__kicker', '2xs');
    expectFont(workspaceCss, '.knowledge-home__header h1', 'display');
    expectFont(workspaceCss, '.knowledge-home__header p', 'base');
    expectFont(workspaceCss, '.knowledge-home__destination-title', 'lg');
    expectFont(workspaceCss, '.knowledge-home__destination-description', 'sm');
    expectFont(workspaceCss, '.knowledge-home__destination-meta', '2xs');
    expectFont(
      workspaceCss,
      '.knowledge-workspace-shell__home,\n.knowledge-workspace-shell__destination',
      'sm',
    );
  });

  it('keeps every Knowledge destination visible in compact windows', () => {
    expect(workspaceCss).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.knowledge-workspace-shell__navigation\s*\{[^}]*gap:\s*12px;[^}]*padding:\s*0 12px;/,
    );
    expect(workspaceCss).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.knowledge-workspace-shell__home-context\s*\{[^}]*display:\s*none;/,
    );
  });

  it('uses semantic hierarchy throughout the Wiki catalog', () => {
    const mapping = [
      ['.knowledge-catalog__header h1', '2xl'],
      ['.knowledge-catalog__header p', 'base'],
      ['.knowledge-catalog__header-meta', '2xs'],
      ['.knowledge-catalog__filters > label > span', '2xs'],
      ['.knowledge-catalog__filters select', 'sm'],
      ['.knowledge-catalog__section-heading h2', 'lg'],
      ['.knowledge-catalog__section-heading > span', '2xs'],
      ['.knowledge-sop-group__heading h3', 'md'],
      ['.knowledge-sop-card__body strong', 'base'],
      ['.knowledge-sop-card__body span', '2xs'],
      ['.knowledge-cheatsheet-row__copy strong', 'sm'],
      [
        '.knowledge-cheatsheet-row__copy span,\n.knowledge-cheatsheet-row__meta,\n.knowledge-cheatsheet-row__arrow',
        '2xs',
      ],
    ] as const;

    mapping.forEach(([selector, token]) => expectFont(knowledgeCss, selector, token));
  });

  it('uses semantic typography in the Wiki reader chrome', () => {
    const mapping = [
      ['.knowledge-library-toggle', '2xs'],
      ['.knowledge-drawer__title > span', '2xs'],
      ['.knowledge-drawer__title h1', 'lg'],
      ['.knowledge-drawer__manage.tactile-button', 'sm'],
      ['.knowledge-drawer__modes > button', 'sm'],
      ['.knowledge-contents__heading', '2xs'],
      ['.knowledge-outline--contents .knowledge-outline__button', 'xs'],
      ['.knowledge-contents__empty', 'sm'],
      ['.knowledge-category__button', '2xs'],
      ['.knowledge-document-node__button', 'sm'],
      ['.knowledge-document-node__pages,\n.knowledge-outline__page', '2xs'],
      ['.knowledge-outline__button', 'xs'],
      ['.knowledge-drawer__footer', '2xs'],
      ['.knowledge-reader-back', 'xs'],
      ['.knowledge-viewer__identity h2', 'base'],
      ['.knowledge-viewer__section', 'xs'],
      ['.knowledge-viewer__page-status,\n.knowledge-viewer__zoom', 'xs'],
      ['.knowledge-viewer__controls .knowledge-viewer__view-trigger', 'xs'],
      ['.knowledge-viewer__controls .knowledge-viewer__view-option', 'xs'],
      ['.knowledge-page-placeholder', 'sm'],
      ['.knowledge-page__error p', 'base'],
      ['.knowledge-page__error button', 'sm'],
      ['.knowledge-viewer__loading', 'sm'],
      ['.knowledge-viewer-state--error button', 'sm'],
    ] as const;

    mapping.forEach(([selector, token]) => expectFont(knowledgeCss, selector, token));
    const controls = ruleBody(knowledgeCss, '.knowledge-viewer__controls button');
    expect(controls).toContain('min-width: 38px;');
    expect(controls).toContain('height: 38px;');
    expect(controls).toContain('border: 0;');
    expect(controls).toContain('border-radius: 2px;');
    expect(controls).toContain('font-family: var(--font-family-base);');

    const groups = ruleBody(knowledgeCss, '.knowledge-viewer__control-group');
    expect(groups).toContain('height: 38px;');
    expect(groups).toContain('border: 0;');
    expect(groups).toContain('border-radius: 0;');

    const readouts = ruleBody(
      knowledgeCss,
      '.knowledge-viewer__page-status,\n.knowledge-viewer__zoom',
    );
    expect(readouts).toContain('font-family: var(--font-family-base);');
    expect(readouts).not.toContain('border-inline:');

    const panel = ruleBody(knowledgeCss, '.knowledge-viewer__view-panel');
    expect(panel).toContain('width: 232px;');
    expect(panel).toContain('padding: 0;');

    const activeOption = ruleBody(
      knowledgeCss,
      ".knowledge-viewer__controls .knowledge-viewer__view-option[aria-pressed='true']",
    );
    expect(activeOption).toContain('box-shadow: inset 3px 0 0 var(--accent-bright);');
    expect(activeOption).not.toContain('background: var(--accent-subtle);');
  });

  it('uses structural viewer-owned responsiveness instead of toolbar padding offsets', () => {
    const viewer = ruleBody(knowledgeCss, '.knowledge-viewer');
    expect(viewer).toContain('container-name: knowledge-pdf-viewer;');
    expect(viewer).toContain('container-type: inline-size;');
    expect(ruleBody(knowledgeCss, '.knowledge-viewer__viewport')).toContain(
      'justify-content: safe center;',
    );
    expect(ruleBody(knowledgeCss, '.knowledge-viewer__toolbar')).toContain('min-height: 58px;');
    expect(knowledgeCss).toMatch(
      /@container knowledge-pdf-viewer \(max-width: 640px\)[\s\S]*?\.knowledge-viewer__toolbar\s*\{[\s\S]*?grid-template-areas:\s*'heading heading'\s*'leading controls';/,
    );
    expect(knowledgeCss).toMatch(
      /@container knowledge-pdf-viewer \(max-width: 900px\)[\s\S]*?\.knowledge-reader-back__label,[\s\S]*?\.knowledge-library-toggle > span\s*\{[\s\S]*?display:\s*none;/,
    );
    expect(knowledgeCss).toMatch(
      /@container knowledge-pdf-viewer \(max-width: 640px\)[\s\S]*?\.knowledge-viewer__controls\s*\{[\s\S]*?justify-content:\s*safe flex-end;[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(knowledgeCss).toMatch(
      /@container knowledge-pdf-viewer \(max-width: 480px\)[\s\S]*?\.knowledge-viewer__page-status\s*\{[^}]*min-width:\s*60px;/,
    );
    expect(knowledgeCss).toMatch(
      /@container knowledge-reader \(max-width: 900px\)[\s\S]*?\.knowledge-drawer\s*\{[\s\S]*?width:\s*min\(320px, calc\(100% - 52px\)\);/,
    );
    expect(knowledgeCss).not.toContain('.knowledge-reader-search-toggle');
    expect(ruleBody(knowledgeCss, '.knowledge-drawer__collapse')).toContain('display: grid;');
    expect(knowledgeCss).not.toMatch(/\.knowledge-viewer__toolbar\s*\{[^}]*padding-top:\s*46px;/s);
    expect(knowledgeCss).not.toMatch(
      /\.knowledge-viewer__toolbar\s*\{[^}]*padding-left:\s*128px;/s,
    );

    expect(
      ruleBody(knowledgeCss, '.knowledge-viewer__page-controls,\n.knowledge-viewer__zoom-controls'),
    ).toContain('border-right: 1px solid var(--color-border);');

    const drawerTitle = ruleBody(knowledgeCss, '.knowledge-drawer__title');
    expect(drawerTitle).toContain('flex: 1;');
    expect(drawerTitle).toContain('min-width: 0;');
    const drawerHeading = ruleBody(knowledgeCss, '.knowledge-drawer__title h1');
    expect(drawerHeading).toContain('max-width: 100%;');
    expect(drawerHeading).toContain('-webkit-line-clamp: 2;');
    expect(drawerHeading).toContain('white-space: normal;');
    expect(drawerHeading).not.toContain('white-space: nowrap;');
  });

  it('uses one focus indicator on each interactive shell', () => {
    const filterShell = ruleBody(knowledgeCss, '.knowledge-catalog__filters > label:focus-within');
    const filterSelect = ruleBody(knowledgeCss, '.knowledge-catalog__filters select:focus-visible');
    expect(filterShell).toContain('box-shadow: 0 0 0 1px var(--accent-dim);');
    expect(filterSelect).toContain('outline: 0 !important;');
    expect(filterSelect).toContain('box-shadow: none !important;');

    const viewerButton = ruleBodies(
      knowledgeCss,
      '.knowledge-viewer__controls button:focus-visible',
    );
    expect(viewerButton).toContain('outline: 2px solid var(--accent-bright);');
    expect(viewerButton).not.toContain('box-shadow:');
    expect(knowledgeCss).not.toContain(
      '.knowledge-drawer-backdrop,\n.knowledge-drawer__close {\n.knowledge-drawer__close',
    );
  });

  it('leaves PDF-derived text sizing under renderer control', () => {
    const layer = ruleBodies(knowledgeCss, '.knowledge-page__text-layer');
    const text = ruleBody(
      knowledgeCss,
      '.knowledge-page__text-layer > :not(.markedContent),\n.knowledge-page__text-layer .markedContent span:not(.markedContent)',
    );

    expect(layer).toContain(
      '--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));',
    );
    expect(text).toContain('font-size: calc(var(--text-scale-factor) * var(--font-height));');
  });

  it('keeps Contacts and Servers readable without shrinking the 67px rows', () => {
    const workspaceMapping = [
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .match-count",
        'sm',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .list-toolbar-sort-label",
        '2xs',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .list-toolbar-sort-select,\n.knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .collapsible-header\n  .tactile-button",
        'sm',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .list-filters\n  .tactile-button--sm",
        'xs',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  :is(.contact-entry-name, .server-card-name)",
        'md',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  :is(.contact-entry-line2, .server-card-meta)",
        'xs',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .detail-panel-name",
        'lg',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .detail-panel-title",
        'sm',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .detail-panel-field-value",
        'base',
      ],
      [
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .detail-panel-field-label,\n.knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .detail-panel-section-label",
        '2xs',
      ],
    ] as const;
    const directoryMapping = [
      ['.detail-panel-name', 'lg'],
      ['.detail-panel-title', 'sm'],
      ['.detail-panel-field-label', '2xs'],
      ['.detail-panel-field-value', 'base'],
      ['.contact-entry-name', 'md'],
      ['.contact-entry-line2', 'xs'],
      ['.server-card-name', 'md'],
      ['.server-card-meta', 'xs'],
    ] as const;

    workspaceMapping.forEach(([selector, token]) => expectFont(workspaceCss, selector, token));
    directoryMapping.forEach(([selector, token]) => expectFont(directoryCss, selector, token));
    expect(
      ruleBody(
        workspaceCss,
        ".knowledge-workspace-shell__panel:is([data-destination='contacts'], [data-destination='servers'])\n  .list-filters\n  .tactile-button--sm",
      ),
    ).toContain('min-height: 32px;');
    expect(workspaceCss).toMatch(
      /@media \(max-width: 1024px\)[\s\S]*?\.detail-panel\s*\{[\s\S]*?display:\s*none;/,
    );
  });

  it('keeps readable Knowledge empty and failure copy on the semantic scale', () => {
    expectFont(workspaceCss, '.knowledge-workspace-shell__failure-eyebrow', '2xs');
    expectFont(knowledgeCss, '.knowledge-empty__path', 'xs');
    expectFont(knowledgeCss, '.knowledge-empty__error', 'sm');
  });
});
