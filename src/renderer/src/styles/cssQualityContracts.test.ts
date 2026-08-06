import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AtRule, type Declaration, type Root, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const cssPath = (relativePath: string) => resolve(process.cwd(), 'src/renderer/src', relativePath);
const readCss = (relativePath: string) => readFileSync(cssPath(relativePath), 'utf8');

const cssSources = {
  alerts: readCss('tabs/alerts.css'),
  assembler: readCss('tabs/assembler/assembler.css'),
  cloudStatus: readCss('tabs/cloud-status.css'),
  components: readCss('styles/components.css'),
  componentsAfterSettings: readCss('styles/components-after-settings.css'),
  directory: readCss('components/directory/directory.css'),
  dynatraceProblems: readCss('tabs/dynatrace-problems.css'),
  knowledge: readCss('features/knowledge/knowledge.css'),
  modals: readCss('styles/modals.css'),
  oncall: readCss('components/oncall/oncall.css'),
  settings: readCss('components/settings/settings.css'),
  toast: readCss('styles/toast.css'),
  utilities: readCss('styles/utilities.css'),
};

function parseCss(source: string): Root {
  return postcss.parse(source);
}

function atRulePath(rule: Rule): string[] | undefined {
  const path: string[] = [];
  let parent = rule.parent;
  while (parent && parent.type !== 'root') {
    if (parent.type !== 'atrule') return undefined;
    const atRule = parent as AtRule;
    path.unshift(`${atRule.name} ${atRule.params}`.trim());
    parent = parent.parent;
  }
  return parent?.type === 'root' ? path : undefined;
}

function exactRules(source: string, selector: string, expectedAtRulePath: string[] = []): Rule[] {
  const expectedSelectors = (postcss.parse(`${selector} {}`).first as Rule).selectors;
  const matches: Rule[] = [];
  parseCss(source).walkRules((rule) => {
    const actualAtRulePath = atRulePath(rule);
    if (
      actualAtRulePath &&
      rule.selectors.length === expectedSelectors.length &&
      rule.selectors.every((candidate, index) => candidate === expectedSelectors[index]) &&
      actualAtRulePath.length === expectedAtRulePath.length &&
      actualAtRulePath.every((atRule, index) => atRule === expectedAtRulePath[index])
    ) {
      matches.push(rule);
    }
  });
  return matches;
}

/** Resolves the single rule a contract is about, failing loudly if it is not unique. */
function exactRule(source: string, selector: string, expectedAtRulePath: string[] = []): Rule {
  const rules = exactRules(source, selector, expectedAtRulePath);
  expect(rules, selector).toHaveLength(1);
  return rules[0]!;
}

function declarations(rule: Rule): Declaration[] {
  return rule.nodes.filter((node): node is Declaration => node.type === 'decl');
}

function declarationValue(rule: Rule, property: string): string | undefined {
  return declarations(rule).find(({ prop }) => prop === property)?.value;
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function declarationEntries(rule: Rule): Array<[string, string]> {
  return declarations(rule).map(({ prop, value }) => [prop, normalizeValue(value)]);
}

function matchingDeclarations(source: string, property: string, value: string): Declaration[] {
  const matches: Declaration[] = [];
  parseCss(source).walkDecls(property, (declaration) => {
    if (declaration.value === value) matches.push(declaration);
  });
  return matches;
}

function significantNodeSignature(node: Rule | AtRule | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'rule') return node.selectors.join(', ');
  const parameters = node.params ? ` ${node.params}` : '';
  return `@${node.name}${parameters}`;
}

function topLevelRuleNeighbors(rule: Rule): {
  previousSibling: string | undefined;
  nextSibling: string | undefined;
} {
  if (rule.parent?.type !== 'root') throw new Error(`${rule.selector} is not a top-level rule`);
  const significantNodes = rule.parent.nodes.filter(
    (node): node is Rule | AtRule => node.type === 'rule' || node.type === 'atrule',
  );
  const ruleIndex = significantNodes.indexOf(rule);
  return {
    previousSibling: significantNodeSignature(significantNodes[ruleIndex - 1]),
    nextSibling: significantNodeSignature(significantNodes[ruleIndex + 1]),
  };
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
      @supports (display: grid) {
        .target { color: purple; }
      }
      @layer components {
        .target { color: yellow; }
      }
      .scope {
        .target { color: black; }
      }
    `;

    expect(exactRules(source, '.target')).toEqual([]);
    expect(
      exactRules(source, '.peer, .target').map((rule) => declarationValue(rule, 'color')),
    ).toEqual(['green']);
  });

  it('treats at-rules as significant cascade siblings', () => {
    const source = `
      .before { color: red; }
      @media (max-width: 800px) { .conditional { color: blue; } }
      .target { color: green; }
      @supports (display: grid) { .supported { display: grid; } }
      .after { color: purple; }
    `;
    const target = exactRule(source, '.target');

    expect(topLevelRuleNeighbors(target)).toEqual({
      previousSibling: '@media (max-width: 800px)',
      nextSibling: '@supports (display: grid)',
    });
  });

  it('keeps each formerly duplicated selector in its original cascade position and order', () => {
    const contracts = [
      {
        source: cssSources.knowledge,
        selector: '.knowledge-page__text-layer',
        location: {
          previousSibling:
            '.knowledge-page__error button:hover, .knowledge-page__error button:focus-visible',
          nextSibling: '.knowledge-page__text-layer :is(span, br)',
        },
        declarations: [
          ['--min-font-size', '1'],
          ['--text-scale-factor', 'calc(var(--total-scale-factor) * var(--min-font-size))'],
          ['--min-font-size-inv', 'calc(1 / var(--min-font-size))'],
          ['color-scheme', 'only light'],
          ['position', 'absolute'],
          ['inset', '0'],
          ['z-index', '1'],
          ['overflow', 'clip'],
          ['line-height', '1'],
          ['text-align', 'initial'],
          ['text-size-adjust', 'none'],
          ['transform-origin', '0 0'],
          ['forced-color-adjust', 'none'],
        ],
      },
      {
        source: cssSources.dynatraceProblems,
        selector: '.dt-profile-picker__bulk-actions span',
        location: {
          previousSibling: '.dt-profile-picker',
          nextSibling: '.dt-profile-picker__search',
        },
        declarations: [
          ['margin-left', 'auto'],
          ['color', 'var(--color-text-tertiary)'],
          ['font-family', 'var(--font-family-mono)'],
          ['font-size', 'var(--text-2xs)'],
        ],
      },
    ] as const;

    for (const { source, selector, location, declarations: expectedDeclarations } of contracts) {
      const rules = exactRules(source, selector);
      expect(rules, selector).toHaveLength(1);
      expect(declarationEntries(rules[0]!), `${selector} declaration values and order`).toEqual(
        expectedDeclarations,
      );
      expect(topLevelRuleNeighbors(rules[0]!), `${selector} top-level rule location`).toEqual(
        location,
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
        exactRules(
          source,
          selector,
          selector === '.assembler-sidebar .assembler-sidebar-panel'
            ? ['media (max-width: 1120px)']
            : [],
        ).some((rule) => declarationValue(rule, property) === value),
        `${selector}: ${property}: ${value}`,
      ).toBe(true);
    }

    const stableGutterContracts = [
      [cssSources.directory, '.detail-panel-body'],
      [cssSources.oncall, '.personnel-tab-root'],
      [cssSources.oncall, '.oncall-masonry'],
      [cssSources.components, '.combobox-dropdown'],
      [cssSources.components, '.group-selector-list'],
      [cssSources.modals, '.search-dropdown-results'],
      [cssSources.assembler, '.assembler-sidebar-panel'],
    ] as const;

    for (const [source, selector] of stableGutterContracts) {
      expect(declarationValue(exactRule(source, selector), 'scrollbar-gutter'), selector).toBe(
        'stable',
      );
    }
  });

  it('keeps Header Search actions aligned and the clear target usable', () => {
    const resultRow = exactRule(cssSources.modals, '.search-dropdown-result-row');
    const hitbox = exactRule(cssSources.modals, '.search-dropdown-hitbox');
    const secondaryAction = exactRule(cssSources.modals, '.search-dropdown-secondary-action');
    const clearButton = exactRule(cssSources.components, '.header-search-bar-clear');

    expect(declarationValue(resultRow, 'position')).toBe('relative');
    expect(declarationValue(hitbox, 'display')).toBe('grid');
    expect(declarationValue(hitbox, 'grid-template-columns')).toContain('minmax(0, 1fr)');
    expect(declarationValue(secondaryAction, 'position')).toBe('absolute');
    expect(declarationValue(clearButton, 'width')).toBe('32px');
    expect(declarationValue(clearButton, 'height')).toBe('32px');
  });

  it('preserves emergency wrapping with standards-based overflow-wrap declarations', () => {
    for (const [name, source] of Object.entries(cssSources)) {
      expect(matchingDeclarations(source, 'word-break', 'break-word'), name).toEqual([]);
    }

    const wrappingSelectors = [
      [cssSources.directory, '.detail-panel-name'],
      [cssSources.alerts, '.alerts-email-subject'],
      [cssSources.alerts, '.alerts-email-body'],
      [cssSources.settings, '.settings-data-path'],
      [cssSources.componentsAfterSettings, '.tooltip-popup'],
      [cssSources.toast, '.toast-message'],
      [cssSources.utilities, '.break-word'],
    ] as const;

    for (const [source, selector] of wrappingSelectors) {
      expect(declarationValue(exactRule(source, selector), 'overflow-wrap'), selector).toBe(
        'anywhere',
      );
    }
  });
});
