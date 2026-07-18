import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('standalone Notes retirement boundaries', () => {
  it('does not clear or seed the archived standalone_notes collection', () => {
    expect(readSource('scripts/seed.mjs')).not.toContain('standalone_notes');
  });

  it('does not create or navigate to standalone Notes in screenshot coverage', () => {
    const screenshotSpec = readSource('tests/e2e/redesign-screenshots.spec.ts');

    expect(screenshotSpec).not.toContain('standalone_notes');
    expect(screenshotSpec).not.toContain('sidebar-notes');
  });

  it('does not retain standalone Notes masonry selectors', () => {
    const responsiveCss = readSource('src/renderer/src/styles/responsive.css');
    const animationsCss = readSource('src/renderer/src/styles/animations.css');

    expect(responsiveCss).not.toMatch(/notes-masonry|relay-grid--notes/);
    expect(animationsCss).not.toContain('notes-masonry');
  });
});
