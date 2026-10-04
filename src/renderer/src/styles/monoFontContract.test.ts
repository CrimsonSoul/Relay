import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * DESIGN §9: mono is reserved for technical tokens — IDs, versions, codes, host:port, keycaps,
 * code/query text — plus the fenced email-preview content (DESIGN §10). Counts, states, dates and
 * metadata use the UI font with tabular numerals. Adding a selector here is a design decision.
 */
const MONO_ALLOW_LIST: Record<string, string[]> = {
  'components/settings/styles/settings-administration.css': [
    'textarea.administration-dql-input',
    '.administration-scope-preview',
  ],
  'components/settings/styles/settings-core.css': [
    '.settings-about__version',
    '.settings-recovery__build-copy strong',
    '.settings-release__version',
    '.settings-readout__value--secret',
    '.privileged-access__code',
    '.privileged-access__challenge-code',
  ],
  'components/settings/styles/settings-integrations.css': ['.dynatrace-dashboard-example'],
  'components/sidebar/sidebar.css': ['.sidebar-tooltip-key'],
  'features/knowledge/knowledgeWorkspace.css': ['.knowledge-home__search-shortcut'],
  'styles/components/components-layout.css': ['.empty-state__kbd'],
  'features/tickets/tickets.css': ['.ticket-id'],
  'styles/components/components-controls.css': ['.release-notes-content code'],
  'styles/components/components-overlays.css': ['.shortcuts-modal-key', '.shortcuts-modal-kbd'],
  'styles/setup.css': ['.setup-config__discover-addr'],
  'styles/theme.css': ['kbd, code, pre'],
  'tabs/alerts/alerts-email-card.css': [
    '.alerts-email-meta-item',
    '.alerts-email-footer-timestamp',
    ".alerts-email-body [data-hl='service'], .alerts-editable-body [data-hl='service']",
  ],
  'tabs/alerts/alerts-email-event.css': ['.alerts-email-event-time-value'],
  'tabs/dynatrace-problems.css': [
    '.dt-problems__hints kbd',
    '.dt-problem-row__response-ticket',
    '.dt-problem-row__meta span:first-child',
    '.dt-problem-detail__identity > span:first-child',
    '.dt-problem-note__ticket strong',
  ],
};

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

function monoSelectors(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const file of cssFiles(rendererRoot)) {
    postcss.parse(readFileSync(file, 'utf8')).walkDecls((declaration) => {
      if (declaration.prop.startsWith('--')) return;
      if (!declaration.value.includes('--font-family-mono')) return;
      const parent = declaration.parent;
      const selector =
        parent?.type === 'rule' ? (parent as Rule).selectors.join(', ') : String(parent?.type);
      const key = relative(rendererRoot, file).split('\\').join('/');
      const selectors = found[key] ?? [];
      selectors.push(selector);
      found[key] = selectors;
    });
  }
  return found;
}

describe('monospace font contract (DESIGN §9)', () => {
  it('limits --font-family-mono to the technical-token allow-list', () => {
    const found = monoSelectors();
    const sorted = (record: Record<string, string[]>) =>
      Object.fromEntries(
        Object.entries(record)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, selectors]) => [file, [...selectors].sort((a, b) => a.localeCompare(b))]),
      );
    expect(sorted(found)).toEqual(sorted(MONO_ALLOW_LIST));
  });
});
