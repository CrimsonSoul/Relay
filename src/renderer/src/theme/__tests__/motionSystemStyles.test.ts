import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCssBundle } from '../../styles/readCssBundle.test-util';

const themeCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/theme.css'), 'utf8');
const animationCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/animations.css'),
  'utf8',
);
const componentsCss = readCssBundle('styles/components.css');
const modalsCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/modals.css'),
  'utf8',
);
const statusbarCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/statusbar.css'),
  'utf8',
);
const knowledgeCss = readCssBundle('features/knowledge/knowledge.css');
const knowledgeWorkspaceCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/knowledge/knowledgeWorkspace.css'),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

function cssVar(name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}:\\s*([^;]+);`, 'm').exec(themeCss)?.[1]?.trim() ?? '';
}

describe('Operational silk motion system', () => {
  it('defines the six approved duration tiers and one easing curve', () => {
    expect(cssVar('--motion-duration-instant')).toBe('100ms');
    expect(cssVar('--motion-duration-control')).toBe('160ms');
    expect(cssVar('--motion-duration-state')).toBe('240ms');
    expect(cssVar('--motion-duration-layer-enter')).toBe('300ms');
    expect(cssVar('--motion-duration-layer-exit')).toBe('160ms');
    expect(cssVar('--motion-duration-structure')).toBe('320ms');
    expect(cssVar('--motion-ease-out')).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
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
    expect(animationCss).toContain('transform: translateY(10px);');
    expect(animationCss).toContain('@keyframes relay-popover-in');
    expect(animationCss).toContain('translate: 0 -8px;');
    expect(animationCss).toContain('@keyframes relay-toast-in');
    expect(animationCss).toContain('transform: translateX(12px);');
    expect(animationCss).toContain("[data-motion='popover']");
  });

  it('keeps reduced motion static and state-preserving', () => {
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms !important/,
    );
    expect(animationCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/,
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
      /:is\(input, select, textarea\)\.tactile-input\.tactile-input\s*{[^}]*border-color var\(--transition-fast\)/,
    );
    expect(componentsCss).toMatch(
      /\.group-selector-checkbox\s*{[^}]*background-color var\(--transition-fast\)/,
    );
  });

  it('uses shared state and structure tokens in Knowledge', () => {
    expect(knowledgeWorkspaceCss).toMatch(
      /\.knowledge-workspace-shell__panel\[data-state='active'\][\s\S]*relay-panel-in var\(--motion-duration-state\)/,
    );
    expect(knowledgeCss).toMatch(
      /\.knowledge-drawer\s*{[\s\S]*transform var\(--motion-duration-structure\) var\(--motion-ease-out\)/,
    );
    expect(knowledgeCss).toMatch(
      /\.knowledge-drawer-backdrop\s*{[\s\S]*opacity var\(--motion-duration-state\) var\(--motion-ease-out\)/,
    );
    expect(knowledgeCss).not.toMatch(/\.knowledge-page[^}]*animation:/);
  });

  it('does not stagger operational lists', () => {
    expect(animationCss).not.toContain('.stagger-children');
    expect(animationCss).not.toContain('.animate-card-entrance');
  });

  it('keeps the always-visible connection indicator compositor-idle', () => {
    expect(statusbarCss).toMatch(/\.status-bar-live-dot\s*{[^}]*background:\s*var\(--ok\)/);
    expect(statusbarCss).not.toMatch(/\.status-bar-live-dot\s*{[^}]*animation:/);
    expect(animationCss).not.toContain('@keyframes breathe');
  });

  it('uses canonical font tokens and removes superseded motion helpers', () => {
    const rendererCss = [themeCss, animationCss, componentsCss, modalsCss].join('\n');
    expect(rendererCss).not.toContain('var(--font-mono)');
    expect(modalsCss).toMatch(
      /\.modal-dialog-generic\s*{[^}]*font-family:\s*var\(--font-family-base\)/,
    );
    expect(animationCss).not.toContain('.animate-fade-in');
    expect(animationCss).not.toContain('.animate-scale-in');
    expect(animationCss).not.toContain('@keyframes scaleIn');
    expect(animationCss).not.toContain('@keyframes cardEntrance');
  });

  it('installs one UI family and one technical family', () => {
    expect(packageJson.dependencies).not.toHaveProperty('@fontsource/ibm-plex-mono');
    expect(packageJson.dependencies).toHaveProperty('@fontsource/ibm-plex-sans');
    expect(packageJson.dependencies).toHaveProperty('@fontsource/jetbrains-mono');
  });

  it('uses the shared square modal geometry and state-driven layer motion', () => {
    expect(modalsCss).toContain(".modal-dialog-generic[data-variant='confirmation']");
    expect(modalsCss).toContain('--modal-width: 400px;');
    expect(modalsCss).toContain('--modal-width: 560px;');
    expect(modalsCss).toContain('--modal-width: 820px;');
    expect(modalsCss).toContain('--modal-width: 960px;');
    expect(modalsCss).toMatch(/\.modal-dialog-generic\s*{[^}]*border-radius:\s*2px/);
    expect(modalsCss).toMatch(/\.modal-dialog-generic\s*{[^}]*box-shadow:\s*var\(--shadow-sm\)/);
    expect(modalsCss).toMatch(
      /\.modal-dialog-generic\s*{[^}]*font-family:\s*var\(--font-family-base\)/,
    );
    expect(modalsCss).toContain('translateY(14px) scale(0.99)');
    expect(modalsCss).not.toContain('.modal-accent-line');
    expect(modalsCss).not.toContain('backdrop-filter');
  });
});
