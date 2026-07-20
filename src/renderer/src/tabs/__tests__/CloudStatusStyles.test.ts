import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/tabs/cloud-status.css'), 'utf8');

describe('Cloud Status responsive styling', () => {
  it('keeps all-clear provider actions reachable in short windows', () => {
    const allClearBody = /\.cloud-status__all-clear-body\s*{([^}]*)}/.exec(css)?.[1] ?? '';

    expect(allClearBody).toContain('overflow-y: auto');
    expect(allClearBody).toContain('justify-content: safe center');
  });

  it('uses sharp geometry for status data cards', () => {
    const providerChip = /\.cloud-status-provider-chip\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    const outageCard = /\.cloud-status-outage\s*{([^}]*)}/.exec(css)?.[1] ?? '';

    expect(providerChip).toContain('border-radius: 0');
    expect(outageCard).toContain('border-radius: 0');
  });
});
