import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(resolve(__dirname, '../../styles/theme.css'), 'utf8');

const cssVar = (name: string) =>
  new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([^;]+);`, 'm').exec(
    themeCss,
  )?.[1] ?? '';

const ruleFor = (selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm').exec(themeCss)?.[1] ?? '';
};

describe('theme tokens', () => {
  it('uses softened charcoal foundations instead of pure black and white', () => {
    expect(cssVar('--color-bg-app')).toBe('#09090b');
    expect(cssVar('--color-bg-surface')).toBe('#111114');
    expect(cssVar('--color-bg-surface-2')).toBe('#19191d');
    expect(cssVar('--color-bg-surface-elevated')).toBe('#222227');
    expect(cssVar('--color-bg-sidebar')).toBe('#0b0b0d');
    expect(cssVar('--color-text-primary')).toBe('#eee9ec');
    expect(cssVar('--color-text-quaternary')).toBe('#847c82');
  });

  it('maps the pink accent tokens to the configured rose family', () => {
    const pinkRule = ruleFor(":root[data-accent='pink']");

    expect(pinkRule).toContain('--accent: #fc8da9');
    expect(pinkRule).toContain('--accent-hover: #ffa4ba');
    expect(pinkRule).toContain('--accent-bright: #ffc6d4');
  });
});
