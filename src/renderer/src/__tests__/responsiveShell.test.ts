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

const forcedColoursCss = mediaBlock(responsiveCss, 'forced-colors: active') ?? '';

function forcedRuleFor(selector: string): string {
  const start = forcedColoursCss.indexOf(selector);
  if (start === -1) return '';
  const open = forcedColoursCss.indexOf('{', start);
  return forcedColoursCss.slice(open + 1, forcedColoursCss.indexOf('}', open));
}

describe('compact Relay shell', () => {
  it('collapses the main sidebar and keeps only the clock time below desktop width', () => {
    const compactBlock = mediaBlock(responsiveCss, 'max-width: 1200px');

    expect(compactBlock).toBeDefined();
    expect(compactBlock).toContain('--sidebar-width-collapsed: 64px');
    expect(compactBlock).toMatch(/\.sidebar-button-label[\s\S]*?display:\s*none/);
    expect(compactBlock).toMatch(/\.world-clock-details\s*\{[^}]*display:\s*none/u);
    expect(compactBlock).not.toMatch(/\.world-clock-container\s*\{[^}]*display:\s*none/u);
    expect(compactBlock).toMatch(/\.sidebar-app-icon-label::before[\s\S]*?content:\s*'r'/);
    expect(mediaBlock(responsiveCss, 'max-width: 720px')).toMatch(
      /\.world-clock-container\s*\{[^}]*display:\s*none/u,
    );
  });

  it('expands compact labels over content on hover or keyboard focus only', () => {
    const compactBlock = mediaBlock(responsiveCss, 'max-width: 1200px') ?? '';

    expect(compactBlock).toContain('.sidebar-shell');
    expect(compactBlock).toContain('flex: 0 0 var(--sidebar-width-collapsed)');
    expect(compactBlock).toMatch(
      /\.sidebar-shell:is\(:hover,\s*:has\(:focus-visible\)\)\s+\.sidebar/,
    );
    expect(compactBlock).not.toContain(':focus-within');
    expect(compactBlock).toMatch(/width:\s*152px/);
    expect(compactBlock).toMatch(
      /\.sidebar-shell:is\(:hover,\s*:has\(:focus-visible\)\)[\s\S]*?\.sidebar-button-label[\s\S]*?display:\s*block/,
    );
  });

  it('turns off the web banner offset transition under reduced motion', () => {
    expect(mediaBlock(responsiveCss, 'prefers-reduced-motion: reduce')).toMatch(
      /\.web-runtime-banner\s*\{[^}]*transition:\s*none/u,
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
    expect(compactBlock).not.toMatch(/\.world-clock-container\s*\{[^}]*display:\s*none/u);
  });

  it('protects the release reminder from narrow Windows header controls', () => {
    expect(mediaBlock(responsiveCss, 'max-width: 1200px')).toMatch(
      /\.platform-win32 \.app-header\s*\{[^}]*padding-right:\s*156px/u,
    );
    const windowControlsBlock = mediaBlock(responsiveCss, 'max-width: 980px') ?? '';
    const narrowBlock = mediaBlock(responsiveCss, 'max-width: 720px') ?? '';

    expect(windowControlsBlock).toMatch(
      /\.platform-win32 \.app-header\s*\{[^}]*padding-right:\s*156px/u,
    );
    expect(narrowBlock).toMatch(/\.header-title-container[^{]*\{[^}]*display:\s*none/u);
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
      /\.release-update-modal__steps\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u,
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

  it('gives native form controls one managed focus ring and a distinct invalid shape', () => {
    const formFocusRule =
      /^:where\(input, textarea, select\):focus-visible\s*\{([^}]*)\}/m.exec(responsiveCss)?.[1] ??
      '';
    const formFocusBorder =
      /^:where\(input, textarea, select\):not\(\[aria-invalid='true'\]\):focus-visible\s*\{([^}]*)\}/m.exec(
        responsiveCss,
      )?.[1] ?? '';
    const formInvalidRule =
      /^:where\(input, textarea, select\)\[aria-invalid='true'\]\s*\{([^}]*)\}/m.exec(
        responsiveCss,
      )?.[1] ?? '';

    expect(formFocusRule).toContain('outline: 3px solid var(--accent-bright) !important;');
    expect(formFocusRule).toContain('outline-offset: 2px !important;');
    expect(formFocusRule).not.toContain('outline: none');
    expect(formFocusRule).not.toContain('box-shadow');
    expect(formFocusBorder).toContain('border-color: var(--accent-bright) !important;');
    expect(formInvalidRule).toContain('border-color: var(--alarm) !important;');
    expect(formInvalidRule).toContain(
      'box-shadow: inset var(--rail-width) 0 0 var(--alarm) !important;',
    );
  });

  it('keeps the global focus ring in the earliest layer so component rings can override it', () => {
    const themeCss = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/styles/theme.css'),
      'utf8',
    );
    const globalRing = /^:focus-visible\s*\{([^}]*)\}/m.exec(themeCss)?.[1] ?? '';

    expect(globalRing).toContain('outline: 3px solid var(--accent-bright);');
    expect(globalRing).toContain('outline-offset: 2px;');
    expect(globalRing).not.toContain('!important');
    expect(responsiveCss).not.toMatch(/^:focus-visible\s*\{/m);
  });

  it('restates selection, unread, checkbox and wrapper focus states in forced colours', () => {
    const ruleFor = forcedRuleFor;

    for (const selector of [
      '.dt-problem-row--selected',
      ".ticket-list tr[aria-selected='true'] > td:first-child",
      '.sdp-selected-row > td:first-child',
      '.administration-settings__rail a.is-active',
    ]) {
      expect(ruleFor(selector), selector).toContain(
        'border-left: var(--rail-width) solid Highlight;',
      );
    }
    expect(ruleFor('.notification-entry.is-unread')).toContain(
      'border-left: var(--rail-width) solid CanvasText;',
    );
    expect(ruleFor('.sig-grp-check {')).toContain('forced-color-adjust: none;');
    expect(ruleFor('.sig-grp--on .sig-grp-check')).toContain('background: Highlight;');
    expect(ruleFor('.header-search-bar:focus-within')).toContain('outline: 2px solid Highlight;');
    expect(ruleFor('.knowledge-catalog__filters > label:focus-within')).toContain(
      'outline: 2px solid Highlight;',
    );
    expect(ruleFor('.tab-strip__tab {')).toContain('border-bottom-color: Canvas;');
    expect(
      ruleFor(
        ".tab-strip__tab:is([aria-selected='true'], [aria-current='page'], [aria-pressed='true']) {",
      ),
    ).toContain('border-bottom-color: Highlight;');
  });

  it('restates Settings switch and pressed toggle states in forced colours', () => {
    const forced = forcedColoursCss;
    const ruleFor = forcedRuleFor;

    const track = ruleFor('.settings-switch__control {');
    expect(track).toContain('forced-color-adjust: none;');
    expect(track).toContain('border-color: CanvasText;');
    expect(ruleFor('.settings-switch__control::before {')).toContain('background: CanvasText;');
    expect(ruleFor('.settings-switch__control:checked {')).toContain('background: Highlight;');
    expect(ruleFor('.settings-switch__control:checked::before {')).toContain(
      'background: HighlightText;',
    );

    const pressedStart = forced.indexOf('.alerts-fmt-btn.active');
    const pressedOpen = forced.indexOf('{', pressedStart);
    const pressedSelector = forced.slice(pressedStart, pressedOpen);
    const pressedRule = forced.slice(pressedOpen + 1, forced.indexOf('}', pressedOpen));
    expect(pressedSelector).toContain(".cloud-status__region-filter button[aria-pressed='true']");
    expect(pressedSelector).toContain('.tactile-button.is-active:not(.list-filter-toggle)');
    expect(pressedRule).toContain('forced-color-adjust: none;');
    expect(pressedRule).toContain('background: Highlight;');
    expect(pressedRule).toContain('color: HighlightText;');
    expect(
      ruleFor(".knowledge-viewer__controls .knowledge-viewer__view-option[aria-pressed='true'] {"),
    ).toContain('border-left-color: Highlight;');
  });
});
