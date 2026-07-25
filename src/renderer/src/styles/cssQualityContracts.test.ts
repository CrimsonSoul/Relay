import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Declaration, type Root, type Rule } from 'postcss';
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

function parseCss(source: string): Root {
  return postcss.parse(source);
}

function exactRules(source: string, selector: string): Rule[] {
  const expectedSelectors = (postcss.parse(`${selector} {}`).first as Rule).selectors;
  const matches: Rule[] = [];
  parseCss(source).walkRules((rule) => {
    if (
      rule.selectors.length === expectedSelectors.length &&
      rule.selectors.every((candidate, index) => candidate === expectedSelectors[index])
    ) {
      matches.push(rule);
    }
  });
  return matches;
}

function declarations(rule: Rule): Declaration[] {
  return rule.nodes.filter((node): node is Declaration => node.type === 'decl');
}

function declarationValue(rule: Rule, property: string): string | undefined {
  return declarations(rule).find(({ prop }) => prop === property)?.value;
}

function declarationProperties(rule: Rule): string[] {
  return declarations(rule).map(({ prop }) => prop);
}

function matchingDeclarations(source: string, property: string, value: string): Declaration[] {
  const matches: Declaration[] = [];
  parseCss(source).walkDecls(property, (declaration) => {
    if (declaration.value === value) matches.push(declaration);
  });
  return matches;
}

function sourceOffset(rule: Rule): number {
  return rule.source?.start?.offset ?? Number.MAX_SAFE_INTEGER;
}

describe('CSS zero-warning contracts', () => {
  it('matches exact selectors without conflating contextual selectors or selector lists', () => {
    const source = `
      /* A contextual rule must not count as the standalone selector. */
      .parent .target { color: red; }
      .target:hover { color: orange; }
      .peer,
      .target { color: green; }
      @media (max-width: 800px) {
        .target { color: blue; }
      }
    `;

    expect(exactRules(source, '.target').map((rule) => declarationValue(rule, 'color'))).toEqual([
      'blue',
    ]);
    expect(
      exactRules(source, '.peer, .target').map((rule) => declarationValue(rule, 'color')),
    ).toEqual(['green']);
  });

  it('keeps each formerly duplicated selector in its original cascade position and order', () => {
    const contracts = [
      {
        source: cssSources.cloudStatus,
        selector: '.cloud-status__refresh',
        beforeSelector: '.cloud-status__refresh:hover:not(:disabled)',
        properties: [
          'display',
          'width',
          'height',
          'align-items',
          'justify-content',
          'padding',
          'border',
          'border-radius',
          'background',
          'color',
          'cursor',
          'transition',
        ],
      },
      {
        source: cssSources.knowledge,
        selector: '.knowledge-page__text-layer',
        beforeSelector: '.knowledge-page__text-layer :is(span, br)',
        properties: [
          '--min-font-size',
          '--text-scale-factor',
          '--min-font-size-inv',
          'color-scheme',
          'position',
          'inset',
          'z-index',
          'overflow',
          'line-height',
          'text-align',
          'text-size-adjust',
          'transform-origin',
          'forced-color-adjust',
        ],
      },
      {
        source: cssSources.dynatraceProblems,
        selector: '.dt-profile-picker__bulk-actions span',
        beforeSelector: '.dt-profile-picker__search',
        properties: ['margin-left', 'color', 'font-family', 'font-size'],
      },
    ];

    for (const { source, selector, beforeSelector, properties } of contracts) {
      const rules = exactRules(source, selector);
      const followingRule = exactRules(source, beforeSelector)[0];
      expect(rules, selector).toHaveLength(1);
      expect(declarationProperties(rules[0]), `${selector} declaration order`).toEqual(properties);
      expect(sourceOffset(rules[0]), `${selector} cascade position`).toBeLessThan(
        sourceOffset(followingRule),
      );
    }
  });

  it('uses stable standard overflow for scroll containers without changing their scroll axis', () => {
    for (const [name, source] of Object.entries(cssSources)) {
      expect(matchingDeclarations(source, 'overflow', 'overlay'), name).toEqual([]);
      expect(matchingDeclarations(source, 'overflow-x', 'overlay'), name).toEqual([]);
      expect(matchingDeclarations(source, 'overflow-y', 'overlay'), name).toEqual([]);
    }

    const scrollContracts = [
      [cssSources.directory, '.detail-panel-body', 'overflow-y', 'auto'],
      [cssSources.oncall, '.popout-board', 'overflow-y', 'auto'],
      [cssSources.oncall, '.personnel-tab-root', 'overflow-y', 'auto'],
      [cssSources.oncall, '.oncall-masonry', 'overflow-y', 'auto'],
      [cssSources.components, '.combobox-dropdown', 'overflow-y', 'auto'],
      [cssSources.components, '.group-selector-list', 'overflow-y', 'auto'],
      [cssSources.components, '.error-page-stack', 'overflow', 'auto'],
      [cssSources.modals, '.search-dropdown-results', 'overflow-y', 'auto'],
      [cssSources.assembler, '.assembler-sidebar-panel', 'overflow-y', 'auto'],
      [cssSources.assembler, '.assembler-sidebar .assembler-sidebar-panel', 'overflow-y', 'auto'],
    ] as const;

    for (const [source, selector, property, value] of scrollContracts) {
      expect(
        exactRules(source, selector).some((rule) => declarationValue(rule, property) === value),
        `${selector}: ${property}: ${value}`,
      ).toBe(true);
    }

    const stableGutterContracts = [
      [cssSources.directory, '.detail-panel-body'],
      [cssSources.oncall, '.popout-board'],
      [cssSources.oncall, '.personnel-tab-root'],
      [cssSources.oncall, '.oncall-masonry'],
      [cssSources.components, '.combobox-dropdown'],
      [cssSources.components, '.group-selector-list'],
      [cssSources.modals, '.search-dropdown-results'],
      [cssSources.assembler, '.assembler-sidebar-panel'],
    ] as const;

    for (const [source, selector] of stableGutterContracts) {
      expect(declarationValue(exactRules(source, selector)[0], 'scrollbar-gutter'), selector).toBe(
        'stable',
      );
    }
  });

  it('preserves emergency wrapping with standards-based overflow-wrap declarations', () => {
    for (const [name, source] of Object.entries(cssSources)) {
      expect(matchingDeclarations(source, 'word-break', 'break-word'), name).toEqual([]);
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
      expect(declarationValue(exactRules(source, selector)[0], 'overflow-wrap'), selector).toBe(
        'anywhere',
      );
    }
  });
});
