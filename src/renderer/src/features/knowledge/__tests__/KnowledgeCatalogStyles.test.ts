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

  it('keeps native select controls from drawing a second focus ring inside the filter shell', () => {
    expect(css).toMatch(
      /\.knowledge-catalog__filters select:focus-visible\s*\{[^}]*outline:\s*0 !important;[^}]*box-shadow:\s*none !important;/,
    );
  });

  it('keeps reader categories visible at a legible hierarchy size', () => {
    const category = ruleBody('.knowledge-category__button');
    expect(category).toContain('font-size: var(--text-2xs);');
  });

  it('keeps full covers uncropped in stable shells', () => {
    expect(ruleBody('.knowledge-sop-card__cover')).toContain('aspect-ratio: 3 / 4;');
    expect(ruleBody('.knowledge-sop-card__cover img')).toContain('object-fit: contain;');
  });

  it('keeps cheatsheets visually separate from cover shelves', () => {
    expect(ruleBody('.knowledge-cheatsheet-row')).toContain('min-height: 64px;');
    expect(ruleBody('.knowledge-cheatsheet-row')).not.toContain('aspect-ratio');
    expect(ruleBody('.knowledge-catalog__cheatsheets')).toContain(
      'border-top: 1px solid var(--color-border);',
    );
  });

  it('gives catalog search and filters readable rows at half-monitor widths', () => {
    expect(css).toMatch(
      /@media \(max-width: 1080px\)[\s\S]*?\.knowledge-catalog__filters\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*\}[\s\S]*?\.knowledge-catalog__search\s*\{[^}]*grid-column:\s*1 \/ -1;/,
    );
  });
});
