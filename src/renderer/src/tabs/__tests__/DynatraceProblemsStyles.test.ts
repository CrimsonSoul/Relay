import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/tabs/dynatrace-problems.css'),
  'utf8',
);

const ticketCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/tickets/tickets.css'),
  'utf8',
);

describe('Dynatrace local disposition styling', () => {
  it('uses informational blue for Addressed locally', () => {
    const block = /\.dt-problem-badge--addressed\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(block).toContain('border-color: var(--info)');
    expect(block).toContain('var(--info) 12%');
    expect(block).toContain('color: var(--info-bright)');
  });

  it('responds to the detail pane width instead of the application viewport', () => {
    expect(css).toMatch(
      /\.dt-problems__detail\s*{[^}]*container-name:\s*dynatrace-problem-detail;[^}]*container-type:\s*inline-size;/s,
    );
    expect(css).toMatch(
      /@container dynatrace-problem-detail \(max-width: 680px\)[\s\S]*?\.dt-problem-detail__response-actions\s*{[\s\S]*?width:\s*100%;[\s\S]*?flex-wrap:\s*wrap;/,
    );
  });

  it('resets horizontal bases when the response actions stack', () => {
    expect(css).toMatch(
      /@container dynatrace-problem-detail \(max-width: 420px\)[\s\S]*?\.dt-problem-resolver,\s*\.dt-problems__primary-action\s*\{[^}]*flex:\s*0 0 auto;/,
    );
  });

  it('keeps the resolver chevron inset from the select edge', () => {
    const block = /\.dt-problem-resolver select\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(block).toContain('padding: 0 34px 0 var(--space-3)');
    const sharedControl =
      /:is\(\.tickets-tab, \.sdp-ticket-dialog, \.dt-problems\) select:not\(\[multiple\]\)\s*{([^}]*)}/.exec(
        ticketCss,
      )?.[1] ?? '';
    expect(sharedControl).toContain('appearance: none');
    expect(sharedControl).toContain('padding-right: 38px');
    expect(sharedControl).toContain('calc(100% - 15px) 50%');
    expect(ticketCss).toContain('select:not([multiple]):open::picker-icon');
  });
});
