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
    const roleRule = ruleFor('.team-row-role');

    expect(topRule).toContain('grid-template-columns: minmax(0, 1fr) max-content');
    expect(bottomRule).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, max-content)');
    expect(bottomRule).toContain('column-gap: 12px');
    expect(roleRule).toContain('overflow-wrap: anywhere');
    expect(statusRule).toContain('min-width: 0');
    expect(statusRule).toContain('max-width: 100%');
    expect(statusRule).toContain('flex-wrap: wrap');
    expect(statusRule).toContain('justify-content: flex-end');
  });

  it('highlights primary on-call rows with a quiet team-color tint', () => {
    const primaryRule = ruleFor('.team-row--primary');
    const primaryHoverRule = ruleFor('.team-row--primary:hover');
    const primaryNameRule = ruleFor('.team-row--primary .team-row-name');
    const primaryRoleRule = ruleFor('.team-row--primary .team-row-role');

    expect(primaryRule).toContain(
      'background: color-mix(in srgb, var(--team-color-fill, var(--accent)) 9%, transparent)',
    );
    expect(primaryHoverRule).toContain(
      'background: color-mix(in srgb, var(--team-color-fill, var(--accent)) 13%, transparent)',
    );
    expect(primaryNameRule).toContain('font-weight: 800');
    expect(primaryRoleRule).toContain('color: var(--team-color, var(--accent-bright))');
  });

  it('scales name and phone from a board-scoped font variable while keeping role markers visible', () => {
    const rowRule = ruleFor('.team-row');
    const rootRule = ruleFor('.personnel-tab-root, .popout-board');
    const nameRule = ruleFor('.team-row-name');
    const nameTooltipRule = ruleFor('.team-row-name-wrapper .tooltip-trigger');
    const phoneRule = ruleFor('.team-row-phone');
    const roleCodeRule = ruleFor('.team-row-role-code');

    expect(rowRule).toContain('container-type: inline-size');
    expect(rootRule).toContain('--oncall-font-scale: 1');
    expect(nameRule).toContain('font-size: var(--oncall-name-font-size)');
    expect(nameRule).toContain('white-space: normal');
    expect(nameRule).toContain('overflow: visible');
    expect(nameRule).toContain('overflow-wrap: anywhere');
    expect(nameRule).toContain('text-overflow: clip');
    expect(nameTooltipRule).toContain('overflow: visible');
    expect(phoneRule).toContain('font-size: var(--oncall-phone-font-size)');
    expect(phoneRule).toContain('white-space: nowrap');
    expect(roleCodeRule).toContain('font-size: var(--oncall-role-code-font-size)');
    expect(roleCodeRule).toContain('flex-shrink: 0');
    expect(onCallCss).toContain('@container (max-width: 320px)');
  });

  it('uses compact row spacing so wall-display scaling does not waste vertical space', () => {
    const rootRule = ruleFor('.personnel-tab-root, .popout-board');
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

  it('keeps the board font scale control compact enough for the header', () => {
    expect(onCallCss).toContain('.oncall-font-scale-control');
    expect(onCallCss).toContain('height: 32px');
  });
});
