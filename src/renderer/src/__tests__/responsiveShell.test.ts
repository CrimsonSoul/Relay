import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCssBundle } from '../styles/readCssBundle.test-util';

const responsiveCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/responsive.css'),
  'utf8',
);
const componentsCss = readCssBundle('styles/components.css');
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

  it('expands compact labels over content on hover or focus without changing shell width', () => {
    const compactBlock = mediaBlock(responsiveCss, 'max-width: 1200px') ?? '';

    expect(compactBlock).toContain('.sidebar-shell');
    expect(compactBlock).toContain('flex: 0 0 var(--sidebar-width-collapsed)');
    expect(compactBlock).toMatch(/\.sidebar-shell:is\(:hover,\s*:focus-within\)\s+\.sidebar/);
    expect(compactBlock).toMatch(/width:\s*136px/);
    expect(compactBlock).toMatch(
      /\.sidebar-shell:is\(:hover,\s*:focus-within\)[\s\S]*?\.sidebar-button-label[\s\S]*?display:\s*block/,
    );
  });

  it('keeps the release reminder visible with a compact label below desktop width', () => {
    const compactBlock = mediaBlock(responsiveCss, 'max-width: 1200px') ?? '';

    expect(compactBlock).toMatch(
      /\.release-update-indicator__wide-label\s*\{[^}]*display:\s*none/u,
    );
    expect(compactBlock).toMatch(
      /\.release-update-indicator\.tactile-button\s*\{[^}]*padding-inline:\s*10px/u,
    );
    expect(compactBlock).not.toMatch(
      /\.release-update-indicator(?!__)[^{]*\{[^}]*display:\s*none/u,
    );
    expect(compactBlock).toMatch(/\.world-clock-container[\s\S]*?display:\s*none/u);
  });

  it('protects the release reminder from narrow Windows header controls', () => {
    const windowControlsBlock = mediaBlock(responsiveCss, 'max-width: 980px') ?? '';
    const narrowBlock = mediaBlock(responsiveCss, 'max-width: 720px') ?? '';

    expect(windowControlsBlock).toMatch(
      /\.platform-win32 \.app-header\s*\{[^}]*padding-right:\s*156px/u,
    );
    expect(narrowBlock).toMatch(/\.header-title-container\s*\{[^}]*display:\s*none/u);
    expect(narrowBlock).toMatch(/\.header-search-container\s*\{[^}]*min-width:\s*0/u);
    expect(narrowBlock).toMatch(/\.header-search-bar\s*\{[^}]*min-width:\s*0/u);
    expect(narrowBlock).toMatch(/\.header-search-bar-shortcut\s*\{[^}]*display:\s*none/u);
    expect(narrowBlock).toMatch(
      /\.release-update-indicator\.tactile-button\s*\{[^}]*padding-inline:\s*8px/u,
    );
  });

  it('keeps explicit space between the release label and version', () => {
    expect(componentsCss).toMatch(
      /\.release-update-indicator__wide-label\s*\{[^}]*margin-inline-end:\s*4px/u,
    );
  });

  it('keeps the manual update flow usable at a 400px viewport', () => {
    const narrowUpdateBlock = mediaBlock(responsiveCss, 'max-width: 520px') ?? '';

    expect(componentsCss).toMatch(
      /\.release-update-modal__steps\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u,
    );
    expect(narrowUpdateBlock).toMatch(
      /\.release-update-modal \.modal-footer-generic\s*\{[^}]*flex-direction:\s*column/u,
    );
    expect(narrowUpdateBlock).toMatch(
      /\.release-update-modal \.modal-footer-generic > \.tactile-button\s*\{[^}]*width:\s*100%/u,
    );
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
