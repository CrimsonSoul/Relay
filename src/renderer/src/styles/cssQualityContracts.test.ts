import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = (relativePath: string) => resolve(process.cwd(), 'src/renderer/src', relativePath);
const readCss = (relativePath: string) => readFileSync(cssPath(relativePath), 'utf8');

const cssSources = {
  alerts: readCss('tabs/alerts.css'),
  assembler: readCss('tabs/assembler/assembler.css'),
  cloudStatus: readCss('tabs/cloud-status.css'),
  components: readCss('styles/components.css'),
  directory: readCss('components/directory/directory.css'),
  dynatraceProblems: readCss('tabs/dynatrace-problems.css'),
  knowledge: readCss('features/knowledge/knowledge.css'),
  modals: readCss('styles/modals.css'),
  oncall: readCss('components/oncall/oncall.css'),
  toast: readCss('styles/toast.css'),
  utilities: readCss('styles/utilities.css'),
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ruleBodies(source: string, selector: string): string[] {
  return Array.from(
    source.matchAll(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'gm')),
    (match) => match[1],
  );
}

function ruleBody(source: string, selector: string): string {
  return ruleBodies(source, selector)[0] ?? '';
}

describe('CSS zero-warning contracts', () => {
  it('keeps each formerly duplicated selector in one cascade position with all declarations intact', () => {
    const selectors = [
      {
        source: cssSources.cloudStatus,
        selector: '.cloud-status__refresh',
        declarations: ['display: inline-flex;', 'width: 40px;', 'height: 40px;'],
      },
      {
        source: cssSources.knowledge,
        selector: '.knowledge-page__text-layer',
        declarations: [
          'position: absolute;',
          '--min-font-size: 1;',
          '--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));',
        ],
      },
      {
        source: cssSources.dynatraceProblems,
        selector: '.dt-profile-picker__bulk-actions span',
        declarations: [
          'color: var(--color-text-tertiary);',
          'margin-left: auto;',
          'font-family: var(--font-family-mono);',
        ],
      },
    ];

    for (const { source, selector, declarations } of selectors) {
      const bodies = ruleBodies(source, selector);
      expect(bodies, selector).toHaveLength(1);
      for (const declaration of declarations) {
        expect(bodies[0], `${selector}: ${declaration}`).toContain(declaration);
      }
    }
  });

  it('uses standard auto overflow for scroll containers without changing their scroll axis', () => {
    for (const [name, source] of Object.entries(cssSources)) {
      expect(source, name).not.toMatch(/overflow(?:-[xy])?:\s*overlay\s*;/);
    }

    const scrollContracts = [
      [cssSources.directory, '.detail-panel-body', 'overflow-y: auto;'],
      [cssSources.oncall, '.popout-board', 'overflow-y: auto;'],
      [cssSources.oncall, '.personnel-tab-root', 'overflow-y: auto;'],
      [cssSources.oncall, '.oncall-masonry', 'overflow-y: auto;'],
      [cssSources.components, '.combobox-dropdown', 'overflow-y: auto;'],
      [cssSources.components, '.group-selector-list', 'overflow-y: auto;'],
      [cssSources.components, '.error-page-stack', 'overflow: auto;'],
      [cssSources.modals, '.search-dropdown-results', 'overflow-y: auto;'],
      [cssSources.assembler, '.assembler-sidebar-panel', 'overflow-y: auto;'],
      [cssSources.assembler, '.assembler-sidebar .assembler-sidebar-panel', 'overflow-y: auto;'],
    ] as const;

    for (const [source, selector, declaration] of scrollContracts) {
      expect(
        ruleBodies(source, selector).some((body) => body.includes(declaration)),
        `${selector}: ${declaration}`,
      ).toBe(true);
    }
  });

  it('preserves emergency wrapping with standards-based overflow-wrap declarations', () => {
    for (const [name, source] of Object.entries(cssSources)) {
      expect(source, name).not.toMatch(/word-break:\s*break-word\s*;/);
    }

    const wrappingSelectors = [
      [cssSources.directory, '.detail-panel-name'],
      [cssSources.alerts, '.alerts-email-subject'],
      [cssSources.alerts, '.alerts-email-body'],
      [cssSources.components, '.settings-data-path'],
      [cssSources.components, '.tooltip-popup'],
      [cssSources.toast, '.toast-message'],
      [cssSources.utilities, '.break-word'],
    ] as const;

    for (const [source, selector] of wrappingSelectors) {
      expect(ruleBody(source, selector), selector).toContain('overflow-wrap: anywhere;');
    }
  });
});
