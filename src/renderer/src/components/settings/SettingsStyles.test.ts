import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postcss, { type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(process.cwd(), 'src/renderer/src');

function expandImports(path: string, visited = new Set<string>()): string {
  const absolutePath = resolve(rendererRoot, path);
  if (visited.has(absolutePath)) return '';
  visited.add(absolutePath);
  const source = readFileSync(absolutePath, 'utf8');
  return source.replace(/@import\s+['"]([^'"]+)['"];?/g, (_statement, importPath: string) => {
    const imported = resolve(dirname(absolutePath), importPath);
    const relative = imported.slice(rendererRoot.length + 1);
    return expandImports(relative, visited);
  });
}

function finalDeclarations(source: string, selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  postcss.parse(source).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector) || rule.parent?.type !== 'root') return;
    rule.walkDecls((declaration: Declaration) => {
      result[declaration.prop] = declaration.value.replace(/\s+/g, ' ').trim();
    });
  });
  return result;
}

describe('Settings stylesheet outcomes', () => {
  const styles = expandImports('styles.css');

  it('keeps the page Appearance workspace in its two-column layout', () => {
    expect(finalDeclarations(styles, '.settings-page .settings-section--appearance')).toMatchObject(
      {
        display: 'grid',
        'grid-template-columns': 'minmax(0, 1.1fr) minmax(320px, 0.9fr)',
        'align-content': 'start',
        'align-items': 'start',
      },
    );
  });

  it('keeps Relay connection copy rows aligned with their inline actions', () => {
    expect(finalDeclarations(styles, '.settings-copy-row')).toMatchObject({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      gap: '12px',
    });
  });

  it('keeps accent schedule labels and controls on the established grid', () => {
    expect(finalDeclarations(styles, '.accent-schedule-row')).toMatchObject({
      display: 'grid',
      'grid-template-columns': '16px minmax(0, 1fr) minmax(118px, 148px)',
      'align-items': 'center',
      gap: '8px',
    });
  });
});
