import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const responsiveCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/responsive.css'),
  'utf8',
);
const dynatraceCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/tabs/dynatrace-problems.css'),
  'utf8',
);

function mediaBlock(css: string, query: string): string | undefined {
  const start = css.indexOf(`@media (${query})`);
  if (start === -1) return undefined;
  const openingBrace = css.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }
  return undefined;
}

describe('compact Relay shell', () => {
  it('collapses the main sidebar and removes the clock below desktop width', () => {
    const compactBlock = mediaBlock(responsiveCss, 'max-width: 1200px');

    expect(compactBlock).toBeDefined();
    expect(compactBlock).toContain('--sidebar-width-collapsed: 64px');
    expect(compactBlock).toMatch(/\.sidebar-button-label[\s\S]*?display:\s*none/);
    expect(compactBlock).toMatch(/\.world-clock-container[\s\S]*?display:\s*none/);
    expect(compactBlock).toMatch(/\.sidebar-app-icon-label::before[\s\S]*?content:\s*'r'/);
  });

  it('switches the Dynatrace queue and detail to one column before half-screen width', () => {
    expect(dynatraceCss).toContain('@media (max-width: 900px)');
    expect(dynatraceCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.dt-problems__workspace\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
    );
  });

  it('uses one managed focus ring for native form controls', () => {
    const formFocusRule =
      /:where\(input, textarea, select\):focus-visible\s*\{([^}]*)\}/m.exec(responsiveCss)?.[1] ??
      '';

    expect(formFocusRule).toContain('outline: none !important;');
    expect(formFocusRule).toContain('outline-offset: 0 !important;');
    expect(formFocusRule).toContain('border-color: var(--color-accent) !important;');
    expect(formFocusRule).toContain('box-shadow: 0 0 0 2px var(--color-accent-dim) !important;');
    expect(responsiveCss.indexOf(':where(input, textarea, select):focus-visible')).toBeGreaterThan(
      responsiveCss.indexOf(':focus-visible'),
    );
  });
});
