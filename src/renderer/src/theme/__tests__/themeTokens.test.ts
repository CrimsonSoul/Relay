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
  it('maps the pink accent tokens to the configured rose family', () => {
    const pinkRule = ruleFor(":root[data-accent='pink']");

    expect(pinkRule).toContain('--accent: #fc8da9');
    expect(pinkRule).toContain('--accent-hover: #ffa4ba');
    expect(pinkRule).toContain('--accent-bright: #ffc6d4');
  });

  it('uses IBM Plex Sans as the product UI base font', () => {
    expect(cssVar('--font-family-base')).toBe("'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif");
  });

  it('keeps every native Windows select and popup option on the dark Relay palette', () => {
    const selectRule = ruleFor('select');
    expect(selectRule).toContain('color-scheme: dark');
    expect(selectRule).toContain('background-color: var(--color-bg-surface)');
    expect(selectRule).toContain('color: var(--color-text-primary)');

    const popupRule = /select option,\s*select optgroup\s*\{([^}]*)\}/m.exec(themeCss)?.[1] ?? '';
    expect(popupRule).toContain('background-color: var(--color-bg-surface)');
    expect(popupRule).toContain('color: var(--color-text-primary)');
  });
});
