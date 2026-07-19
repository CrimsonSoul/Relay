import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/theme.css'), 'utf8');
const animationCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/animations.css'),
  'utf8',
);
const componentsCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/components.css'),
  'utf8',
);

function cssVar(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}:\\s*([^;]+);`, 'm').exec(themeCss)?.[1]?.trim() ?? '';
}

describe('Operational silk motion system', () => {
  it('defines the six approved duration tiers and one easing curve', () => {
    expect(cssVar('--motion-duration-instant')).toBe('100ms');
    expect(cssVar('--motion-duration-control')).toBe('140ms');
    expect(cssVar('--motion-duration-state')).toBe('160ms');
    expect(cssVar('--motion-duration-layer-enter')).toBe('220ms');
    expect(cssVar('--motion-duration-layer-exit')).toBe('160ms');
    expect(cssVar('--motion-duration-structure')).toBe('240ms');
    expect(cssVar('--motion-ease-out')).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('removes bounce and premium aliases while mapping compatibility aliases', () => {
    expect(themeCss).not.toContain('--transition-bouncy');
    expect(themeCss).not.toContain('--transition-premium');
    expect(cssVar('--transition-micro')).toBe(
      'var(--motion-duration-instant) var(--motion-ease-out)',
    );
    expect(cssVar('--transition-fast')).toBe(
      'var(--motion-duration-control) var(--motion-ease-out)',
    );
    expect(cssVar('--transition-base')).toBe('var(--motion-duration-state) var(--motion-ease-out)');
    expect(cssVar('--transition-smooth')).toBe(
      'var(--motion-duration-structure) var(--motion-ease-out)',
    );
  });

  it('provides bounded shared panel, popover, and toast entrances', () => {
    expect(animationCss).toContain('@keyframes relay-panel-in');
    expect(animationCss).toContain('transform: translateY(4px);');
    expect(animationCss).toContain('@keyframes relay-popover-in');
    expect(animationCss).toContain('transform: translateY(-4px);');
    expect(animationCss).toContain('@keyframes relay-toast-in');
    expect(animationCss).toContain('transform: translateX(8px);');
    expect(animationCss).toContain("[data-motion='popover']");
  });

  it('keeps reduced motion static and state-preserving', () => {
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms !important/,
    );
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transform:\s*none !important/,
    );
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*scroll-behavior:\s*auto !important/,
    );
  });

  it('uses the shared panel animation for retained top-level tabs', () => {
    expect(componentsCss).toMatch(
      /\.tab-panel--active\s*{[^}]*animation:\s*relay-panel-in var\(--motion-duration-state\) var\(--motion-ease-out\)/,
    );
  });

  it('keeps shared form feedback on the control tier', () => {
    expect(componentsCss).toMatch(
      /input\.tactile-input\.tactile-input\s*{[^}]*border-color var\(--transition-fast\)/,
    );
    expect(componentsCss).toMatch(
      /\.group-selector-checkbox\s*{[^}]*background-color var\(--transition-fast\)/,
    );
  });
});
