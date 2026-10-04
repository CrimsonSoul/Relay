import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * DESIGN §8: Relay has two field heights — the 44px default (`--field-height`) and the 36px
 * compact size (`--field-height-compact`) for dense toolbars. Every single-line text field, select
 * and field frame takes its height from one of those tokens; textareas size by `min-height` and
 * are exempt. `auto` and `100%` (a field filling a framed wrapper that owns the height) are the
 * only non-token values allowed.
 */
const FIELD_HEIGHTS: Record<string, true> = {
  'var(--field-height)': true,
  'var(--field-height-compact)': true,
  auto: true,
  '100%': true,
};

/** Selectors that end on a single-line field or a field frame. */
const BARE_FIELD_SELECTOR = /(?:^|[\s>+~(])(?:input|select)(?![\w-])[^\s>+~]*$/;
const CLASSED_FIELD_SELECTOR =
  /\.(?:tactile-input|[\w-]+-(?:select|input|search|search-bar|field input))(?![\w-])[^\s>+~]*$/;
const NOT_A_TEXT_FIELD =
  /checkbox|radio|range|\[multiple\]|::|option|-wrap|:has\(|(?:^|(?<!,)[\s>])textarea/;

/** Selection checkboxes whose markup is a bare `input` inside a row label. */
const CHECKBOX_SELECTORS: Record<string, true> = {
  '.knowledge-management .knowledge-management-row__select input': true,
  '.sdp-select-ticket input': true,
};

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

function offTokenFieldHeights(): string[] {
  const found: string[] = [];
  for (const file of cssFiles(rendererRoot)) {
    const key = relative(rendererRoot, file).split('\\').join('/');
    postcss.parse(readFileSync(file, 'utf8')).walkDecls(/^(?:min-)?height$/, (declaration) => {
      if (FIELD_HEIGHTS[declaration.value]) return;
      const parent = declaration.parent;
      if (parent?.type !== 'rule') return;
      const fieldSelector = (parent as Rule).selectors.find(
        (selector) =>
          (BARE_FIELD_SELECTOR.test(selector) || CLASSED_FIELD_SELECTOR.test(selector)) &&
          !NOT_A_TEXT_FIELD.test(selector) &&
          !CHECKBOX_SELECTORS[selector],
      );
      if (!fieldSelector) return;
      found.push(`${key}: ${fieldSelector} { ${declaration.prop}: ${declaration.value} }`);
    });
  }
  return found;
}

describe('field height contract (DESIGN §8)', () => {
  it('defines the two field heights as tokens', () => {
    const theme = readFileSync(join(rendererRoot, 'styles/theme.css'), 'utf8');
    expect(theme).toMatch(/--field-height:\s*44px;/);
    expect(theme).toMatch(/--field-height-compact:\s*36px;/);
  });

  it('sizes every single-line field with --field-height or --field-height-compact', () => {
    expect(offTokenFieldHeights()).toEqual([]);
  });
});
