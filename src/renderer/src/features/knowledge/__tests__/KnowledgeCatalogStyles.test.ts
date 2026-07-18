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

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

describe('Knowledge catalog visual details', () => {
  it('uses the same legible SVG search treatment as the reader library', () => {
    expect(library).toMatch(/className="knowledge-catalog__search"[\s\S]*?<svg aria-hidden="true"/);
    const icon = ruleBody('.knowledge-catalog__search svg');
    expect(icon).toContain('width: 16px;');
    expect(icon).toContain('height: 16px;');
    expect(icon).toContain('stroke-width: 2;');
  });

  it('reserves an inset lane for controlled filter chevrons', () => {
    const select = ruleBody('.knowledge-catalog__filters > label select');
    expect(select).toContain('appearance: none;');
    expect(select).toContain('-webkit-appearance: none;');
    expect(select).toContain('padding: 0 34px 0 10px;');
    expect(select).toContain('background-position: right 12px center;');
  });

  it('separates the Recent divider from independently bordered items', () => {
    const heading = ruleBody('.knowledge-catalog__recent .knowledge-catalog__section-heading');
    const shelf = ruleBody('.knowledge-recent-shelf');
    const item = ruleBody('.knowledge-recent-item');

    expect(heading).toContain('padding-bottom: 12px;');
    expect(heading).toContain('border-bottom: 1px solid var(--color-border);');
    expect(shelf).toContain('gap: 8px;');
    expect(shelf).not.toContain('border-top');
    expect(shelf).not.toContain('border-left');
    expect(item).toContain('border: 1px solid var(--color-border);');
  });

  it('keeps reader categories visible at a legible hierarchy size', () => {
    const category = ruleBody('.knowledge-category__button');
    expect(category).toContain('font-size: 10px;');
  });
});
