import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);
const library = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/KnowledgeLibrary.tsx'),
  'utf8',
);
const searchInput = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/SearchInput.tsx'),
  'utf8',
);

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

describe('Knowledge catalog visual details', () => {
  it('uses the shared legible search treatment', () => {
    expect(library).toMatch(
      /className="knowledge-catalog__search scoped-search-control"[\s\S]*?<SearchInput/,
    );
    expect(searchInput).toMatch(/width="18"/);
    expect(searchInput).toMatch(/height="18"/);
    expect(searchInput).toMatch(/strokeWidth="3"/);
  });

  it('reserves an inset lane for controlled filter chevrons', () => {
    const select = ruleBody('.knowledge-catalog__filters > label select');
    expect(select).toContain('appearance: none;');
    expect(select).toContain('-webkit-appearance: none;');
    expect(select).toContain('padding: 0 34px 0 10px;');
    expect(select).toContain('background-position: right 12px center;');
  });

  it('uses a dark native popup palette so every select option remains legible', () => {
    expect(ruleBody('.knowledge-catalog__filters select')).toContain('color-scheme: dark;');
    const option = ruleBody('.knowledge-catalog__filters option');
    expect(option).toContain('background: var(--color-bg-surface);');
    expect(option).toContain('color: var(--color-text-primary);');
  });

  it('keeps native select controls from drawing a second focus ring inside the filter shell', () => {
    expect(css).toMatch(
      /\.knowledge-catalog__filters select:focus-visible\s*\{[^}]*outline:\s*0 !important;[^}]*box-shadow:\s*none !important;/,
    );
  });

  it('keeps reader categories visible at a legible hierarchy size', () => {
    const category = ruleBody('.knowledge-category__button');
    expect(category).toContain('font-size: var(--text-2xs);');
  });

  it('keeps full covers uncropped in exact-ratio shells with stable fallbacks', () => {
    const cover = ruleBody('.knowledge-sop-card__cover');
    const sheet = ruleBody('.knowledge-sop-card__cover-sheet');

    expect(cover).toContain('aspect-ratio: 3 / 4;');
    expect(cover).toContain('contain: layout;');
    expect(cover).not.toContain('overflow: hidden;');
    expect(sheet).toContain('position: absolute;');
    expect(sheet).toContain('inset: 0;');
    expect(sheet).toContain('overflow: hidden;');
    expect(ruleBody('.knowledge-sop-card__cover img')).toContain('object-fit: contain;');
  });

  it('adds Relay hybrid depth only while a ready cover is hovered or focused', () => {
    const restingSheet = ruleBody('.knowledge-sop-card__cover-sheet');
    const restingEdge = ruleBody(".knowledge-sop-card__cover[data-state='ready']::before");

    expect(restingSheet).not.toContain('box-shadow:');
    expect(restingSheet).not.toContain('filter: drop-shadow');
    expect(restingEdge).toContain('opacity: 0;');
    expect(css).toMatch(
      /\.knowledge-sop-card:hover\s+\.knowledge-sop-card__cover\[data-state='ready'\]\s+\.knowledge-sop-card__cover-sheet,\s*\.knowledge-sop-card:focus-visible\s+\.knowledge-sop-card__cover\[data-state='ready'\]\s+\.knowledge-sop-card__cover-sheet\s*\{[^}]*transform:\s*translate\(-1px, -3px\);[^}]*filter:\s*drop-shadow\(/,
    );
    expect(css).toMatch(
      /\.knowledge-sop-card:hover \.knowledge-sop-card__cover\[data-state='ready'\]::before,[\s\S]*?\.knowledge-sop-card:focus-visible \.knowledge-sop-card__cover\[data-state='ready'\]::before\s*\{[^}]*opacity:\s*1;/,
    );
  });

  it('removes the cover lift when reduced motion is requested', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.knowledge-sop-card__cover-sheet\s*\{[^}]*transition:\s*none;[^}]*\}[\s\S]*?\.knowledge-sop-card:hover\s+\.knowledge-sop-card__cover\[data-state='ready'\]\s+\.knowledge-sop-card__cover-sheet,\s*\.knowledge-sop-card:focus-visible\s+\.knowledge-sop-card__cover\[data-state='ready'\]\s+\.knowledge-sop-card__cover-sheet\s*\{[^}]*transform:\s*none;/,
    );
  });

  it('keeps cheatsheets visually separate from cover shelves', () => {
    const row = ruleBody('.knowledge-cheatsheet-row');
    expect(row).toContain('min-height: 64px;');
    expect(row).not.toContain('aspect-ratio');
    expect(row).toContain('border-top: 1px solid var(--color-border);');

    const cheatsheets = ruleBody('.knowledge-catalog__cheatsheets');
    expect(cheatsheets).toContain('border-top: 1px solid var(--color-border);');
    expect(cheatsheets).toContain('padding-top: var(--space-4);');

    const heading = ruleBody('.knowledge-catalog__cheatsheets .knowledge-catalog__section-heading');
    expect(heading).toContain('padding-bottom: var(--space-4);');
    expect(heading).toContain('border-bottom: 1px solid var(--color-border);');
    expect(heading).toContain('margin-bottom: var(--space-4);');
    expect(ruleBody('.knowledge-cheatsheet-list')).not.toContain(
      'border-top: 1px solid var(--color-border);',
    );
  });

  it('keeps the desktop filter toolbar inset and opaque over scrolling catalog content', () => {
    expect(ruleBody('.knowledge-catalog__filters')).toContain(
      'background: var(--color-bg-surface);',
    );

    const desktopSticky =
      /@media \(min-width: 821px\)\s*\{[\s\S]*?\.knowledge-catalog__filters\s*\{([^}]*)\}/.exec(
        css,
      )?.[1] ?? '';
    expect(desktopSticky).toContain('top: var(--space-4);');
    expect(desktopSticky).toContain('0 calc(-1 * var(--space-4)) 0 var(--color-bg-app),');
    expect(desktopSticky).toContain('0 var(--space-4) 0 var(--color-bg-app);');
  });

  it('gives catalog search and filters readable rows at half-monitor widths', () => {
    expect(css).toMatch(
      /@media \(max-width: 1080px\)[\s\S]*?\.knowledge-catalog__filters\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*\}[\s\S]*?\.knowledge-catalog__search\s*\{[^}]*grid-column:\s*1 \/ -1;/,
    );
  });
});
