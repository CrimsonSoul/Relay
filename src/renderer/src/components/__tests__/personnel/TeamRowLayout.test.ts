import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const onCallCss = readFileSync(resolve(__dirname, '../../oncall/oncall.css'), 'utf8');

const ruleFor = (selector: string) => {
  const selectorPattern = selector
    .split(',')
    .map((part) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*,\\s*');
  return new RegExp(`(?:^|\\n)${selectorPattern}\\s*\\{([^}]*)\\}`, 'm').exec(onCallCss)?.[1] ?? '';
};

describe('TeamRow layout CSS', () => {
  it('lets active status badges wrap inside narrow on-call cards', () => {
    const bottomRule = ruleFor('.team-row-bottom');
    const topRule = ruleFor('.team-row-top');
    const statusRule = ruleFor('.team-row-time-status');

    expect(topRule).toContain('display: flex');
    expect(topRule).toContain('flex-wrap: wrap');
    expect(bottomRule).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, max-content)');
    expect(bottomRule).toContain('column-gap: 12px');
    expect(statusRule).toContain('min-width: 0');
    expect(statusRule).toContain('max-width: 100%');
    expect(statusRule).toContain('flex-wrap: wrap');
    expect(statusRule).toContain('justify-content: flex-end');
  });

  it('leaves role tiers untinted so no row reads as selected; the chip carries the tier', () => {
    expect(onCallCss).not.toMatch(/\.team-row--(primary|backup)(:hover)?\s*\{/);
    expect(onCallCss).not.toMatch(/\.team-row--primary\.team-row--active/);
    expect(ruleFor('.team-row--primary .team-row-name')).toContain(
      'font-weight: var(--weight-bold)',
    );
    expect(ruleFor('.team-row-role-code--primary')).toContain(
      'background: var(--color-text-primary)',
    );
  });

  it('sets the role word in secondary ink at the board scale and drops it only on narrow rows', () => {
    const roleWordRule = ruleFor('.team-row-role-word');
    expect(roleWordRule).toContain('font-size: var(--oncall-secondary-font-size)');
    expect(roleWordRule).toContain('color: var(--color-text-secondary)');
    expect(roleWordRule).toContain('text-overflow: ellipsis');
    expect(onCallCss).toMatch(
      /@container \(max-width: 13em\) \{\s*\.team-row-role-word \{\s*display: none;\s*\}\s*\.team-row-name-wrapper > \.tooltip-trigger:first-child \{\s*display: inline-flex;/,
    );
    // One role marker per width: wide rows hide the code's tooltip trigger.
    expect(ruleFor('.team-row-name-wrapper > .tooltip-trigger:first-child')).toContain(
      'display: none',
    );
  });

  it('scales name and phone from a board-scoped font variable while keeping role markers visible', () => {
    const rowRule = ruleFor('.team-row');
    const rootRule = ruleFor('.personnel-tab-root');
    const nameRule = ruleFor('.team-row-name');
    const nameTooltipRule = ruleFor('.team-row-name-wrapper .tooltip-trigger');
    const phoneRule = ruleFor('.team-row-phone');
    const roleCodeRule = ruleFor('.team-row-role-code');

    expect(rowRule).toContain('container-type: inline-size');
    expect(rowRule).toContain('font-size: var(--oncall-name-font-size)');
    expect(rootRule).toContain('--oncall-font-scale: 1');
    expect(nameRule).toContain('font-size: var(--oncall-name-font-size)');
    // Wrap at spaces only; one word wider than the row ellipsizes behind the full-name Tooltip.
    expect(nameRule).toContain('white-space: normal');
    expect(nameRule).toContain('overflow-wrap: normal');
    expect(nameRule).toContain('word-break: normal');
    expect(nameRule).toContain('overflow: hidden');
    expect(nameRule).toContain('text-overflow: ellipsis');
    expect(nameTooltipRule).toContain('min-width: 0');
    expect(ruleFor('.team-row-name-wrapper > .tooltip-trigger:first-child')).toContain(
      'flex-shrink: 0',
    );
    expect(phoneRule).toContain('font-size: var(--oncall-phone-font-size)');
    expect(phoneRule).toContain('white-space: nowrap');
    expect(ruleFor('.team-row-phone-source')).toContain('display: block');
    expect(roleCodeRule).toContain('font-size: var(--oncall-role-code-font-size)');
    expect(roleCodeRule).toContain('flex-shrink: 0');
    // em on the row = the zoomed name size, so the stacking point scales with A-/A+.
    expect(onCallCss).toContain('@container (max-width: 17em)');
  });

  it('uses compact row spacing so wall-display scaling does not waste vertical space', () => {
    const rootRule = ruleFor('.personnel-tab-root');
    const topRule = ruleFor('.team-row-top');
    const bottomRule = ruleFor('.team-row-bottom');
    const roleCodeRule = ruleFor('.team-row-role-code');
    const activePillRule = ruleFor('.team-row-active-pill');

    expect(rootRule).toContain('--oncall-row-padding-y: clamp(6px');
    expect(topRule).toContain('margin-bottom: 2px');
    expect(bottomRule).toContain('margin-top: -1px');
    expect(roleCodeRule).toContain('height: calc(var(--oncall-role-code-font-size) * 1.55)');
    expect(activePillRule).toContain('height: 18px');
  });

  it('keeps card group chrome tight without crowding the on-call rows', () => {
    const teamCardRule = ruleFor('.card-surface.team-card-body');
    const headerRule = ruleFor('.team-card-header-row');
    const healthBadgeRule = ruleFor('.team-health-badge');
    const masonryRule = ruleFor('.oncall-masonry');
    const columnRule = ruleFor('.oncall-masonry-column');

    expect(teamCardRule).toContain('padding-left: 12px');
    expect(headerRule).toContain('padding: 8px 12px');
    expect(healthBadgeRule).toContain('min-height: 20px');
    expect(healthBadgeRule).toContain('padding: 0 7px');
    expect(masonryRule).toContain('gap: 20px');
    expect(columnRule).toContain('gap: 20px');
  });

  it('wraps the Assign button below "No coverage" on narrow cards instead of clipping it', () => {
    expect(ruleFor('.team-card-empty')).toContain('flex-wrap: wrap');
    expect(ruleFor('.team-card-empty-status')).toContain('white-space: nowrap');
  });
});
