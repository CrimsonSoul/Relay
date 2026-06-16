import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const onCallCss = readFileSync(resolve(__dirname, '../../oncall/oncall.css'), 'utf8');

const ruleFor = (selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm').exec(onCallCss)?.[1] ?? '';
};

describe('TeamRow layout CSS', () => {
  it('lets active status badges wrap inside narrow on-call cards', () => {
    const bottomRule = ruleFor('.team-row-bottom');
    const statusRule = ruleFor('.team-row-time-status');
    const roleRule = ruleFor('.team-row-role');

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

  it('defines larger readable type steps for standard and wall board display sizes', () => {
    expect(onCallCss).toContain('.personnel-tab-root--display-standard .team-row-name');
    expect(onCallCss).toContain('.popout-board--display-standard .team-row-name');
    expect(onCallCss).toContain('font-size: var(--text-md)');
    expect(onCallCss).toContain('.personnel-tab-root--display-standard .team-row-phone');
    expect(onCallCss).toContain('.popout-board--display-standard .team-row-phone');
    expect(onCallCss).toContain('font-size: var(--text-base)');
    expect(onCallCss).toContain('.personnel-tab-root--display-wall .team-row-name');
    expect(onCallCss).toContain('.popout-board--display-wall .team-row-name');
    expect(onCallCss).toContain('font-size: var(--text-lg)');
    expect(onCallCss).toContain('.personnel-tab-root--display-wall .team-row-phone');
    expect(onCallCss).toContain('.popout-board--display-wall .team-row-phone');
  });

  it('keeps the board text size selector compact enough for the header', () => {
    expect(onCallCss).toContain('.oncall-display-control');
    expect(onCallCss).toContain('grid-template-columns: repeat(3, 28px)');
    expect(onCallCss).toContain('height: 32px');
  });
});
