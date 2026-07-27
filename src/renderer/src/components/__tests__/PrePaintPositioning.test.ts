import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/**
 * jsdom never paints, so the one-frame flash these components used to show is
 * invisible to a rendered assertion — the contract is asserted on the source
 * instead, the same way the shared popover motion marker is.
 *
 * Each entry pairs a file with the first line of its measuring effect body.
 */
const MEASURED_PORTALS: [path: string, measurement: string][] = [
  ['src/renderer/src/components/Tooltip.tsx', 'getBoundingClientRect'],
  ['src/renderer/src/components/Combobox.tsx', 'updatePosition();'],
  ['src/renderer/src/components/HeaderSearch.tsx', 'zIndex: 10002,'],
];

/** Which of the two effect hooks encloses `anchor`. */
const enclosingEffectHook = (code: string, anchor: string) => {
  const anchorIndex = code.indexOf(anchor);
  expect(anchorIndex).toBeGreaterThan(-1);
  const preceding = code.slice(0, anchorIndex);
  return preceding.lastIndexOf('useLayoutEffect(') > preceding.lastIndexOf('useEffect(')
    ? 'useLayoutEffect'
    : 'useEffect';
};

describe('pre-paint positioning', () => {
  it.each(MEASURED_PORTALS)('%s measures in a layout effect', (path, measurement) => {
    // A passive effect measures after the portal has already painted at its
    // stale initial coordinates, which reads as a flash in the top-left corner.
    expect(enclosingEffectHook(source(path), measurement)).toBe('useLayoutEffect');
  });

  it('gives the header search dropdown a fixed position before it is measured', () => {
    // `.search-dropdown` carries no position of its own, so without this default
    // the portal lays out in normal flow at the end of <body> on first paint.
    expect(source('src/renderer/src/components/HeaderSearch.tsx')).toContain(
      "useState<React.CSSProperties>({ position: 'fixed' })",
    );
  });
});
