import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/tabs/cloud-status.css'), 'utf8');

describe('Cloud Status responsive styling', () => {
  it('uses sharp geometry for status data cards', () => {
    const outageCard = /\.cloud-status-outage\s*{([^}]*)}/.exec(css)?.[1] ?? '';

    expect(outageCard).toContain('border-radius: 0');
  });

  it('uses the warning semantic color for degraded providers and incidents', () => {
    expect(css).toMatch(/\.cloud-status-provider__signal--degraded\s*{[^}]*var\(--color-warning\)/);
    expect(css).toMatch(/\.cloud-status-provider__state--degraded\s*{[^}]*var\(--color-warning\)/);
    expect(css).toMatch(/\.cloud-status-outage--degraded\s*{[^}]*var\(--color-warning\)/);
  });

  it('centers the provider-detail back icon independently of font glyph metrics', () => {
    const backIcon = /\.cloud-status__back\s*>\s*svg\s*{([^}]*)}/.exec(css)?.[1] ?? '';

    expect(backIcon).toContain('display: block');
    expect(backIcon).toContain('flex: 0 0 auto');
  });

  it('uses a two-column provider overview without an active-issues pane', () => {
    expect(css).toMatch(
      /\.cloud-status__workspace--overview\s+\.cloud-status__provider-list\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.cloud-status__workspace--overview\s+\.cloud-status__provider-list\s*{[^}]*grid-template-columns:\s*1fr/,
    );
  });
});
