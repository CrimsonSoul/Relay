import { describe, expect, it } from 'vitest';
import { readCssBundle } from '../../styles/readCssBundle.test-util';

const css = readCssBundle('components/settings/settings.css');

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)?.[1] ?? '';
}

function mediaBody(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  const end = css.indexOf('@media ', start + 1);
  return css.slice(start, end === -1 ? css.length : end);
}

describe('PrivilegedAccessPanel layout', () => {
  it('contains pairing controls in a bounded shrinkable desktop grid', () => {
    const actions = ruleBody(css, '.privileged-access__pairing-actions');
    const field = ruleBody(css, '.privileged-access__pairing-actions .privileged-access__field');
    const select = ruleBody(css, '.privileged-access__pairing-actions select');

    expect(actions).toContain('display: grid;');
    expect(actions).toContain('width: min(100%, 500px);');
    expect(actions).toContain('min-width: 0;');
    expect(actions).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(actions).toContain('align-items: end;');
    expect(actions).toContain('gap: var(--space-2);');
    expect(actions).toContain('margin-left: auto;');
    expect(actions).not.toContain('min-width: min(100%, 420px);');
    expect(field).toContain('min-width: 0;');
    expect(select).toContain('width: 100%;');
  });

  it('stacks pairing controls at the existing 600px breakpoint', () => {
    const narrowActions = ruleBody(mediaBody(600), '.privileged-access__pairing-actions');

    expect(narrowActions).toContain('width: 100%;');
    expect(narrowActions).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(narrowActions).toContain('margin-left: 0;');
    expect(narrowActions).not.toContain('flex-direction: column;');
  });
});
