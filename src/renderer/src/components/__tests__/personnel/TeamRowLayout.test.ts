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
});
