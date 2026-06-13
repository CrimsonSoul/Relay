import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directoryCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/directory/directory.css'),
  'utf8',
);

const cssBlockFor = (selector: string) => {
  const escaped = selector.replaceAll('.', '\\.');
  const match = new RegExp(`${escaped}\\s*{([^}]*)}`).exec(directoryCss);
  return match?.[1] ?? '';
};

describe('list row rhythm', () => {
  it('keeps People and Servers row surfaces inside the 72px virtual row', () => {
    expect(cssBlockFor('.contact-entry')).toContain('height: 100%');
    expect(cssBlockFor('.server-card-body')).toContain('height: 100%');
  });

  it('uses compact line-height so two-line rows clear their bottom dividers', () => {
    expect(cssBlockFor('.contact-entry-name')).toContain('line-height: 1.1');
    expect(cssBlockFor('.contact-entry-line2')).toContain('line-height: 1.15');
    expect(cssBlockFor('.server-card-name')).toContain('line-height: 1.1');
    expect(cssBlockFor('.server-card-meta')).toContain('line-height: 1.15');
  });
});
