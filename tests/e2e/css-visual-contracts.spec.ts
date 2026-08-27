import { _electron as electron, expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const mainEntry = join(testDirectory, '../fixtures/layoutElectronMain.cjs');
const rendererAssetsDirectory = join(testDirectory, '../../dist/renderer/assets');

function readEmittedCssAsset(chunkName: string): string {
  const matches = readdirSync(rendererAssetsDirectory).filter(
    (fileName) => fileName.startsWith(`${chunkName}-`) && fileName.endsWith('.css'),
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected one emitted ${chunkName} CSS asset, found ${matches.length}: ${matches.join(', ')}`,
    );
  }

  return readFileSync(join(rendererAssetsDirectory, matches[0]), 'utf8');
}

const localLayerImportPattern = /^@import\s+['"]([^'"]+)['"](?:\s+layer\(([^)]+)\))?\s*;/gm;

function readLayeredCssBundle(relativePath: string): string {
  const expand = (absolutePath: string, visited: Set<string>): string => {
    if (visited.has(absolutePath)) return '';
    visited.add(absolutePath);

    return readFileSync(absolutePath, 'utf8').replace(
      localLayerImportPattern,
      (_statement, importPath: string, layerName: string | undefined) => {
        const importedCss = expand(resolve(dirname(absolutePath), importPath), visited);
        return layerName ? `@layer ${layerName} {\n${importedCss}\n}` : importedCss;
      },
    );
  };

  return expand(join(testDirectory, '../../src/renderer/src', relativePath), new Set<string>());
}

const emittedGlobalCss = readEmittedCssAsset('index');
const emittedSettingsCss = readEmittedCssAsset('SettingsModal');
const emittedKnowledgeCss = readEmittedCssAsset('KnowledgeWorkspace');
const emittedAlertsCss = readEmittedCssAsset('AlertsTab');
const themeCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/theme.css'),
  'utf8',
);
const componentsCss = readLayeredCssBundle('styles/components.css');
const sidebarCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);
const responsiveCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/responsive.css'),
  'utf8',
);
const tabChromeCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/tab-chrome.css'),
  'utf8',
);
const modalsCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/modals.css'),
  'utf8',
);
const radarCss = readFileSync(join(testDirectory, '../../src/renderer/src/tabs/radar.css'), 'utf8');
const scrollCss = [
  'components/directory/directory.css',
  'components/oncall/oncall.css',
  'styles/modals.css',
  'tabs/assembler/assembler.css',
]
  .map((relativePath) =>
    readFileSync(join(testDirectory, '../../src/renderer/src', relativePath), 'utf8'),
  )
  .join('\n');

const presetAccents = Array.from(
  themeCss.matchAll(/:root\[data-accent='([^']+)'\]/g),
  (match) => match[1],
);
const accentStates = [
  ...presetAccents.map((id) => ({ id, customHex: null })),
  { id: 'custom-black', customHex: '#000000' },
  { id: 'custom-white', customHex: '#ffffff' },
];

const backgroundTokens = [
  '--color-bg-app',
  '--color-bg-surface',
  '--color-bg-surface-2',
  '--color-bg-surface-3',
  '--color-bg-surface-elevated',
  '--color-bg-card-hover',
  '--color-bg-sidebar',
  '--color-bg-chrome',
];

const contrastStates = [
  {
    issueKey: 'AZ-alM3UTAUVQ8sYgoim',
    selector: '.privileged-access__role--publisher',
    className: 'privileged-access__role privileged-access__role--publisher',
  },
  {
    issueKey: 'AZ-alM3UTAUVQ8sYgoin',
    selector: '.administration-chip--publisher',
    className: 'administration-chip administration-chip--publisher',
  },
  {
    issueKey: 'AZ-alM3UTAUVQ8sYgoio',
    selector: '.administration-chip--pending',
    className: 'administration-chip administration-chip--pending',
  },
];

type Rgba = { r: number; g: number; b: number; a: number };

function parseComputedColor(value: string): Rgba {
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (value.startsWith('rgb(') || value.startsWith('rgba(')) {
    if (channels.length < 3) throw new Error(`Invalid computed RGB color: ${value}`);
    return {
      r: channels[0] / 255,
      g: channels[1] / 255,
      b: channels[2] / 255,
      a: channels[3] ?? 1,
    };
  }

  if (value.startsWith('color(srgb ')) {
    if (channels.length < 3) throw new Error(`Invalid computed sRGB color: ${value}`);
    return {
      r: channels[0],
      g: channels[1],
      b: channels[2],
      a: channels[3] ?? 1,
    };
  }

  throw new Error(`Unsupported computed CSS color: ${value}`);
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test('emitted cascade layers preserve top-level and lazy-feature precedence', async () => {
  const emittedCss = [emittedGlobalCss, emittedSettingsCss, emittedKnowledgeCss, emittedAlertsCss];
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <main>
        <div data-testid="settings-sublayer-probe">Settings sublayer</div>
        <div data-testid="settings-override-probe">Settings override</div>
        <div data-testid="knowledge-sublayer-probe">Knowledge sublayer</div>
        <div data-testid="alerts-sublayer-probe">Alerts sublayer</div>
      </main>
    `);

    for (const css of emittedCss) {
      await window.addStyleTag({ content: css });
    }

    await window.addStyleTag({
      content: `
        /* Reverse source order makes the production layer declarations own precedence. */
        @layer relay.settings.integrations {
          [data-testid='settings-sublayer-probe'] { color: rgb(21, 84, 147); }
        }
        @layer relay.settings.administration {
          [data-testid='settings-sublayer-probe'] { color: rgb(147, 84, 21); }
        }
        @layer relay.settings.core {
          [data-testid='settings-sublayer-probe'] { color: rgb(220, 30, 40); }
        }

        @layer relay.settings-overrides {
          [data-testid='settings-override-probe'] { background-color: rgb(34, 68, 102); }
        }
        @layer relay.settings.integrations {
          [data-testid='settings-override-probe'] { background-color: rgb(153, 51, 102); }
        }

        @layer relay.features.knowledge.responsive {
          [data-testid='knowledge-sublayer-probe'] { color: rgb(35, 125, 85); }
        }
        @layer relay.features.knowledge.management {
          [data-testid='knowledge-sublayer-probe'] { color: rgb(125, 35, 85); }
        }
        @layer relay.features.knowledge.catalog {
          [data-testid='knowledge-sublayer-probe'] { color: rgb(85, 125, 35); }
        }

        @layer relay.features.alerts.responsive {
          [data-testid='alerts-sublayer-probe'] { background-color: rgb(72, 105, 138); }
        }
        @layer relay.features.alerts.email-event {
          [data-testid='alerts-sublayer-probe'] { background-color: rgb(138, 72, 105); }
        }
        @layer relay.features.alerts.composer {
          [data-testid='alerts-sublayer-probe'] { background-color: rgb(105, 138, 72); }
        }
      `,
    });

    await expect(window.getByTestId('settings-sublayer-probe')).toHaveCSS(
      'color',
      'rgb(21, 84, 147)',
    );
    await expect(window.getByTestId('settings-override-probe')).toHaveCSS(
      'background-color',
      'rgb(34, 68, 102)',
    );
    await expect(window.getByTestId('knowledge-sublayer-probe')).toHaveCSS(
      'color',
      'rgb(35, 125, 85)',
    );
    await expect(window.getByTestId('alerts-sublayer-probe')).toHaveCSS(
      'background-color',
      'rgb(72, 105, 138)',
    );
  } finally {
    await app.close();
  }
});

test('collapsed Wiki reader keeps the PDF viewer full-width at the medium desktop breakpoint', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setViewportSize({ width: 1000, height: 700 });
    await window.setContent(`
      <style>${emittedGlobalCss}</style>
      <style>${emittedKnowledgeCss}</style>
      <div class="knowledge-tab" style="width: 936px; height: 500px;">
        <div
          class="knowledge-workspace"
          data-library-collapsed="true"
          style="width: 936px; height: 500px;"
        >
          <button class="knowledge-drawer-backdrop" type="button"></button>
          <aside class="knowledge-drawer"></aside>
          <section class="knowledge-viewer" data-testid="collapsed-reader-viewer"></section>
        </div>
      </div>
    `);

    await expect(window.locator('.knowledge-drawer')).toBeHidden();
    await expect(window.getByTestId('collapsed-reader-viewer')).toHaveCSS('width', '936px');
  } finally {
    await app.close();
  }
});

test('release update actions stay inside the dialog when restart adds a third button', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setViewportSize({ width: 640, height: 480 });
    await window.setContent(`
      <style>${emittedGlobalCss}</style>
      <section class="release-update-modal" style="width: 320px;">
        <footer class="modal-footer-generic">
          <button class="tactile-button" type="button">
            <span class="tactile-button-label">View on GitHub</span>
          </button>
          <button class="tactile-button" type="button">
            <span class="tactile-button-label">Later</span>
          </button>
          <button class="tactile-button tactile-button--primary" type="button">
            <span class="tactile-button-label">Restart Relay</span>
          </button>
        </footer>
      </section>
    `);

    const footer = window.locator('.modal-footer-generic');
    const geometry = await footer.evaluate((element) => {
      const footerRect = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        footerLeft: footerRect.left,
        footerRight: footerRect.right,
        buttons: Array.from(element.querySelectorAll('button'), (button) => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.buttons).toHaveLength(3);
    for (const button of geometry.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(geometry.footerLeft);
      expect(button.right).toBeLessThanOrEqual(geometry.footerRight);
    }
  } finally {
    await app.close();
  }
});

test('release installation progress uses a bounded sweep with a reduced-motion fallback', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>${emittedGlobalCss}</style>
      <div class="release-update-modal__progress">
        <progress
          class="sr-only"
          aria-label="Update installation progress"
          data-mode="indeterminate"
        ></progress>
        <div
          class="release-update-modal__progress-track"
          aria-hidden="true"
          data-mode="indeterminate"
        >
          <span class="release-update-modal__progress-fill"></span>
        </div>
      </div>
    `);

    const progress = window.getByRole('progressbar', { name: 'Update installation progress' });
    const track = window.locator('.release-update-modal__progress-track');
    const fill = window.locator('.release-update-modal__progress-fill');
    const animated = await fill.evaluate((element) => {
      const trackRect = element.parentElement?.getBoundingClientRect();
      const fillRect = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      return {
        animationName: style.animationName,
        fillWidth: fillRect.width,
        trackWidth: trackRect?.width ?? 0,
      };
    });

    expect(animated.animationName).toBe('release-update-progress-sweep');
    expect(animated.fillWidth).toBeGreaterThan(0);
    expect(animated.fillWidth).toBeLessThan(animated.trackWidth);
    await expect(progress).toHaveAttribute('data-mode', 'indeterminate');

    await window.emulateMedia({ reducedMotion: 'reduce' });
    await expect(fill).toHaveCSS('animation-name', 'none');
    await expect(track).toBeVisible();
  } finally {
    await app.close();
  }
});

test('flagged chips retain WCAG text contrast across every Relay accent and opaque background', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style data-production-css="index.css">${emittedGlobalCss}</style>
      <style data-production-css="SettingsModal.css">${emittedSettingsCss}</style>
      <style>
        html, body { margin: 0; }
        .contrast-host { padding: 8px; }
      </style>
      <div class="contrast-host">
        ${contrastStates
          .map(
            ({ issueKey, className }) =>
              `<span data-issue-key="${issueKey}" class="${className}">Contrast</span>`,
          )
          .join('')}
      </div>
    `);

    const ruleCoverage = await window.evaluate((states) => {
      type BrowserStyleRule = {
        readonly selectorText: string;
        readonly style: { getPropertyValue(property: string): string };
      };
      const collectStyleRules = (rules: ArrayLike<object>): BrowserStyleRule[] =>
        Array.from(rules).flatMap((rule) => {
          if (rule instanceof globalThis.CSSStyleRule) return [rule];
          if (!('cssRules' in rule)) return [];
          return collectStyleRules(rule.cssRules as ArrayLike<object>);
        });
      const styleRules = Array.from(globalThis.document.styleSheets)
        .filter((styleSheet) => {
          const owner = styleSheet.ownerNode;
          return (
            owner instanceof globalThis.HTMLStyleElement &&
            owner.dataset.productionCss !== undefined
          );
        })
        .flatMap((styleSheet) => collectStyleRules(styleSheet.cssRules))
        .map((rule) => ({
          background: rule.style.getPropertyValue('background').trim(),
          color: rule.style.getPropertyValue('color').trim(),
          selectors: rule.selectorText.split(',').map((part) => part.trim()),
        }));

      return states.map(({ issueKey, selector, className }) => {
        const chip = globalThis.document.querySelector(`[data-issue-key="${issueKey}"]`);
        if (!(chip instanceof globalThis.HTMLElement)) {
          throw new Error(`Missing chip for ${issueKey}`);
        }
        const rule = styleRules.find((candidate) => candidate.selectors.includes(selector));
        const parent = chip.parentElement;
        if (!(parent instanceof globalThis.HTMLElement)) {
          throw new Error(`Missing chip parent for ${issueKey}`);
        }
        const styles = globalThis.getComputedStyle(chip);
        const parentStyles = globalThis.getComputedStyle(parent);

        return {
          issueKey,
          selector,
          hasExpectedClass: className
            .split(/\s+/u)
            .every((classToken) => chip.classList.contains(classToken)),
          matchesSelector: chip.matches(selector),
          hasRule: rule !== undefined,
          hasColorDeclaration: Boolean(rule?.color),
          hasBackgroundDeclaration: Boolean(rule?.background),
          usesOwnColor: styles.color !== parentStyles.color,
          usesOwnBackground: styles.backgroundColor !== 'rgba(0, 0, 0, 0)',
        };
      });
    }, contrastStates);

    for (const coverage of ruleCoverage) {
      expect(coverage.hasExpectedClass, `${coverage.issueKey} must use its intended classes`).toBe(
        true,
      );
      expect(
        coverage.matchesSelector,
        `${coverage.issueKey} target must match ${coverage.selector}`,
      ).toBe(true);
      expect(coverage.hasRule, `${coverage.issueKey} must have a parsed production CSS rule`).toBe(
        true,
      );
      expect(
        coverage.hasColorDeclaration,
        `${coverage.issueKey} rule must declare a foreground color`,
      ).toBe(true);
      expect(
        coverage.hasBackgroundDeclaration,
        `${coverage.issueKey} rule must declare a background`,
      ).toBe(true);
      expect(coverage.usesOwnColor, `${coverage.issueKey} color must not be inherited`).toBe(true);
      expect(
        coverage.usesOwnBackground,
        `${coverage.issueKey} background must not be transparent`,
      ).toBe(true);
    }

    const rootColorScheme = await window.evaluate(
      () => globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme,
    );
    expect(rootColorScheme).toBe('dark');
    expect(presetAccents).toEqual([
      'red',
      'orange',
      'yellow',
      'blue',
      'cyan',
      'green',
      'lime',
      'pink',
      'purple',
      'violet',
    ]);

    const measurements: Array<{
      issueKey: string;
      selector: string;
      accent: string;
      background: string;
      ratio: number;
    }> = [];

    for (const accent of accentStates) {
      await window.evaluate(({ id, customHex }) => {
        const root = globalThis.document.documentElement;
        if (customHex) {
          root.setAttribute('data-accent', 'custom');
          root.style.setProperty('--accent', customHex);
          root.style.setProperty('--accent-hover', customHex);
          root.style.setProperty('--accent-bright', customHex);
        } else {
          root.setAttribute('data-accent', id);
          root.style.removeProperty('--accent');
          root.style.removeProperty('--accent-hover');
          root.style.removeProperty('--accent-bright');
        }
      }, accent);

      for (const backgroundToken of backgroundTokens) {
        const computed = await window.evaluate(
          ({ token, states }) => {
            const host = globalThis.document.querySelector('.contrast-host');
            if (!(host instanceof globalThis.HTMLElement)) throw new Error('Missing contrast host');
            host.style.background = `var(${token})`;
            const hostBackground = globalThis.getComputedStyle(host).backgroundColor;

            return states.map(({ issueKey, selector }) => {
              const chip = globalThis.document.querySelector(`[data-issue-key="${issueKey}"]`);
              if (!(chip instanceof globalThis.HTMLElement)) {
                throw new Error(`Missing chip for ${issueKey}`);
              }
              const styles = globalThis.getComputedStyle(chip);
              return {
                issueKey,
                selector,
                foreground: styles.color,
                chipBackground: styles.backgroundColor,
                hostBackground,
              };
            });
          },
          { token: backgroundToken, states: contrastStates },
        );

        for (const state of computed) {
          const hostBackground = parseComputedColor(state.hostBackground);
          const chipBackground = composite(
            parseComputedColor(state.chipBackground),
            hostBackground,
          );
          const foreground = composite(parseComputedColor(state.foreground), chipBackground);
          measurements.push({
            issueKey: state.issueKey,
            selector: state.selector,
            accent: accent.id,
            background: backgroundToken,
            ratio: contrastRatio(foreground, chipBackground),
          });
        }
      }
    }

    expect(measurements).toHaveLength(
      contrastStates.length * accentStates.length * backgroundTokens.length,
    );
    if (process.env.RELAY_REPORT_CSS_CONTRAST === '1') {
      const summaries = contrastStates.map(({ issueKey, selector }) => {
        const ratios = measurements
          .filter((measurement) => measurement.issueKey === issueKey)
          .map(({ ratio }) => ratio);
        return {
          issueKey,
          selector,
          minimum: Math.min(...ratios).toFixed(3),
          maximum: Math.max(...ratios).toFixed(3),
          measurements: ratios.length,
        };
      });
      console.log(`Relay CSS contrast evidence: ${JSON.stringify(summaries)}`);
    }
    expect(
      measurements.filter(({ ratio }) => ratio < 4.5),
      measurements
        .sort((left, right) => left.ratio - right.ratio)
        .slice(0, 10)
        .map(
          ({ issueKey, selector, accent, background, ratio }) =>
            `${issueKey} ${selector} ${accent} ${background}: ${ratio.toFixed(3)}:1`,
        )
        .join('\n'),
    ).toEqual([]);
  } finally {
    await app.close();
  }
});

test('stable gutters preserve Relay topology under overlay and classic scrollbar widths', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();
  const classicScrollbarWidth = 16;

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${componentsCss}
        ${scrollCss}
        html, body {
          margin: 0;
          background: var(--color-bg-app);
          color: var(--color-text-primary);
        }
        .layout-contracts {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          width: 920px;
          padding: 20px;
        }
        .fixture-assembler,
        .fixture-oncall {
          box-sizing: border-box;
          width: 440px;
          height: 300px;
        }
        .fixture-menu {
          width: 300px;
        }
        .fixture-modal {
          width: 420px;
          height: 260px;
        }
        .fixture-detail {
          height: 300px;
          margin-left: 0;
        }
        .fixture-error {
          width: 420px;
        }
        .fixture-error .error-page-stack {
          box-sizing: border-box;
          width: 100%;
          height: 70px;
          margin: 0 0 12px;
        }
        .fixture-row {
          min-height: 56px;
        }
        .fixture-team-card {
          min-height: 92px;
          border: 1px solid var(--color-border);
        }
        .fixture-oncall .oncall-masonry {
          flex: 0 0 160px;
        }
        .fixture-oncall-tail {
          min-height: 180px;
          flex: 0 0 180px;
        }
        .fixture-detail-section {
          min-height: 72px;
        }
        /* Add only the classic-scrollbar pressure that the current host has not already consumed. */
        .classic-scrollbar-model [data-scroll-contract] {
          box-sizing: border-box;
          border-inline-end-style: solid !important;
          border-inline-end-color: transparent !important;
          border-inline-end-width: calc(
            var(--relay-native-inline-end-border) + var(--relay-emulated-inline-gutter)
          ) !important;
        }
        .classic-scrollbar-model [data-horizontal-contract] {
          box-sizing: border-box;
          border-block-end-style: solid !important;
          border-block-end-color: transparent !important;
          border-block-end-width: calc(
            var(--relay-native-block-end-border) + var(--relay-emulated-block-gutter)
          ) !important;
        }
      </style>
      <main class="layout-contracts">
        <section class="assembler-layout fixture-assembler" aria-label="Compose layout">
          <aside class="assembler-groups-pane">
            <div class="assembler-sidebar">
              <div class="assembler-sidebar-inner">
                <div class="assembler-sidebar-panel" data-scroll-contract="assembler">
                  <div class="assembler-sidebar-groups">
                    <div class="assembler-sidebar-groups-header">
                      <span class="assembler-sidebar-groups-title">Contact groups</span>
                      <button class="assembler-sidebar-add-btn" data-inline-control>+</button>
                    </div>
                    <div class="assembler-sidebar-group-list" data-row-kind="assembler">
                      <button class="sig-grp fixture-row" data-row-control>Primary group</button>
                    </div>
                  </div>
                  <div class="sig-sidebar-footer"><span>1 group</span></div>
                </div>
              </div>
            </div>
          </aside>
          <div class="assembler-recipients-pane"></div>
        </section>

        <section class="personnel-tab-root fixture-oncall" data-scroll-contract="oncall-root">
          <header class="oncall-page-header">
            <div><div class="oncall-page-context">On-Call</div><h2>Coverage</h2></div>
            <button class="tactile-button" data-inline-control data-leading-control>Manage</button>
          </header>
          <ul class="oncall-masonry" data-scroll-contract="oncall-masonry">
            <div class="oncall-masonry-column" data-row-kind="oncall">
              <li class="oncall-masonry-item fixture-team-card">
                <button class="tactile-button" data-row-control>Primary team</button>
              </li>
            </div>
          </ul>
          <footer class="fixture-oncall-tail" data-oncall-root-last>
            End of on-call coverage
          </footer>
        </section>

        <section class="combobox fixture-menu">
          <div
            class="combobox-dropdown"
            data-scroll-contract="combobox"
            data-row-kind="combobox"
          >
            <button class="combobox-option fixture-row" data-row-control>Primary option</button>
          </div>
        </section>

        <section class="group-selector fixture-menu">
          <div
            class="group-selector-list"
            data-scroll-contract="group-list"
            data-row-kind="group"
          >
            <button class="group-selector-item fixture-row" data-row-control>Primary group</button>
          </div>
        </section>

        <section class="search-dropdown fixture-modal">
          <div class="search-dropdown-context">Search Relay</div>
          <ul
            class="search-dropdown-results"
            data-scroll-contract="search-results"
            data-row-kind="search"
          >
            <li class="search-dropdown-item fixture-row">
              <button class="search-dropdown-hitbox" data-row-control>Primary result</button>
            </li>
          </ul>
        </section>

        <aside class="detail-panel fixture-detail">
          <div
            class="detail-panel-body"
            data-scroll-contract="detail-body"
            data-row-kind="detail"
          >
            <section class="detail-panel-field fixture-detail-section">
              <button class="tactile-button" data-row-control>Primary detail action</button>
            </section>
          </div>
        </aside>

        <section class="fixture-error">
          <pre class="error-page-stack" data-horizontal-contract>Short error</pre>
          <button class="tactile-button" data-error-control>Try Again</button>
        </section>
      </main>
    `);

    const capture = async (mode: 'overlay' | 'classic', scrollToEnd: boolean) =>
      window.evaluate(
        ({ requestedMode, shouldScrollToEnd, targetClassicWidth }) => {
          globalThis.document.body.classList.remove('classic-scrollbar-model');
          const planClassicGutter = (nativeGutter: number) => {
            const emulatedGutter = Math.max(0, targetClassicWidth - nativeGutter);
            return {
              nativeGutter,
              emulatedGutter,
              totalClassicGutter: nativeGutter + emulatedGutter,
            };
          };
          const wideNativeGutterSimulation = planClassicGutter(24);
          const scrollOwners = Array.from(
            globalThis.document.querySelectorAll('[data-scroll-contract]'),
          );
          const gutterMetrics = new Map<
            (typeof scrollOwners)[number],
            ReturnType<typeof planClassicGutter> & { nativeInlineEndBorder: number }
          >();
          for (const element of scrollOwners) {
            if (!(element instanceof globalThis.HTMLElement)) {
              throw new Error('Invalid scroll contract element');
            }
            const styles = globalThis.getComputedStyle(element);
            const inlineStartBorder = Number.parseFloat(styles.borderInlineStartWidth);
            const inlineEndBorder = Number.parseFloat(styles.borderInlineEndWidth);
            const nativeGutter = Math.max(
              0,
              element.offsetWidth - element.clientWidth - inlineStartBorder - inlineEndBorder,
            );
            const gutterPlan = planClassicGutter(nativeGutter);
            element.style.setProperty('--relay-native-inline-end-border', `${inlineEndBorder}px`);
            element.style.setProperty(
              '--relay-emulated-inline-gutter',
              `${gutterPlan.emulatedGutter}px`,
            );
            gutterMetrics.set(element, {
              ...gutterPlan,
              nativeInlineEndBorder: inlineEndBorder,
            });
          }

          const error = globalThis.document.querySelector('[data-horizontal-contract]');
          const control = globalThis.document.querySelector('[data-error-control]');
          if (
            !(error instanceof globalThis.HTMLElement) ||
            !(control instanceof globalThis.HTMLElement)
          ) {
            throw new Error('Missing error layout contract');
          }
          const nativeErrorStyles = globalThis.getComputedStyle(error);
          const blockStartBorder = Number.parseFloat(nativeErrorStyles.borderBlockStartWidth);
          const blockEndBorder = Number.parseFloat(nativeErrorStyles.borderBlockEndWidth);
          const nativeErrorGutter = Math.max(
            0,
            error.offsetHeight - error.clientHeight - blockStartBorder - blockEndBorder,
          );
          const errorGutterPlan = planClassicGutter(nativeErrorGutter);
          error.style.setProperty('--relay-native-block-end-border', `${blockEndBorder}px`);
          error.style.setProperty(
            '--relay-emulated-block-gutter',
            `${errorGutterPlan.emulatedGutter}px`,
          );

          globalThis.document.body.classList.toggle(
            'classic-scrollbar-model',
            requestedMode === 'classic',
          );

          const snapshots = scrollOwners.map((element) => {
            if (!(element instanceof globalThis.HTMLElement)) {
              throw new Error('Invalid scroll contract element');
            }
            element.scrollTop = shouldScrollToEnd ? element.scrollHeight : 0;
            const styles = globalThis.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const controls = Array.from(
              element.querySelectorAll('[data-inline-control], [data-row-control]'),
            );
            const leadingControl = element.querySelector('[data-leading-control]');
            const terminalContent =
              element.dataset.scrollContract === 'oncall-root'
                ? element.querySelector('[data-oncall-root-last]')
                : element.querySelector('[data-last-row]');
            const maxScrollTop = element.scrollHeight - element.clientHeight;
            const viewportTop = rect.top + element.clientTop;
            const viewportBottom = viewportTop + element.clientHeight;
            const isVerticallyVisible = (candidate: typeof terminalContent) => {
              if (!candidate) return undefined;
              const candidateRect = candidate.getBoundingClientRect();
              return (
                candidateRect.top >= viewportTop - 1 && candidateRect.bottom <= viewportBottom + 1
              );
            };
            const metrics = gutterMetrics.get(element);
            if (!metrics) throw new Error('Missing vertical gutter metrics');
            return {
              id: element.dataset.scrollContract,
              clientWidth: element.clientWidth,
              offsetWidth: element.offsetWidth,
              overflowX: styles.overflowX,
              overflowY: styles.overflowY,
              inlineEndBorderWidth: Number.parseFloat(styles.borderInlineEndWidth),
              scrollbarGutter: styles.scrollbarGutter,
              nativeGutter: metrics.nativeGutter,
              emulatedGutter: metrics.emulatedGutter,
              totalClassicGutter: metrics.totalClassicGutter,
              nativeInlineEndBorder: metrics.nativeInlineEndBorder,
              scrollTop: element.scrollTop,
              maxScrollTop,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              controlsWithinClientWidth: controls.every(
                (control) =>
                  control.getBoundingClientRect().right <=
                  rect.left + element.clientLeft + element.clientWidth + 1,
              ),
              leadingControlVisible: isVerticallyVisible(leadingControl),
              terminalContentVisible: isVerticallyVisible(terminalContent),
            };
          });

          error.scrollLeft = shouldScrollToEnd ? error.scrollWidth : 0;
          const errorStyles = globalThis.getComputedStyle(error);
          return {
            mode: requestedMode,
            wideNativeGutterSimulation,
            snapshots,
            error: {
              clientWidth: error.clientWidth,
              offsetWidth: error.offsetWidth,
              clientHeight: error.clientHeight,
              offsetHeight: error.offsetHeight,
              blockEndBorderWidth: Number.parseFloat(errorStyles.borderBlockEndWidth),
              nativeBlockEndBorder: blockEndBorder,
              nativeGutter: errorGutterPlan.nativeGutter,
              emulatedGutter: errorGutterPlan.emulatedGutter,
              totalClassicGutter: errorGutterPlan.totalClassicGutter,
              scrollWidth: error.scrollWidth,
              scrollLeft: error.scrollLeft,
              maxScrollLeft: error.scrollWidth - error.clientWidth,
              overflowX: errorStyles.overflowX,
              controlLeft: control.getBoundingClientRect().left,
              controlWidth: control.getBoundingClientRect().width,
            },
          };
        },
        {
          requestedMode: mode,
          shouldScrollToEnd: scrollToEnd,
          targetClassicWidth: classicScrollbarWidth,
        },
      );

    const before = {
      overlay: await capture('overlay', false),
      classic: await capture('classic', false),
    };

    await window.evaluate(() => {
      globalThis.document.body.classList.remove('classic-scrollbar-model');
      const makeRow = (kind: string, index: number) => {
        const button = globalThis.document.createElement('button');
        button.dataset.rowControl = 'true';
        button.textContent = `${kind} row ${index}`;

        if (kind === 'assembler') {
          button.className = 'sig-grp fixture-row';
          return button;
        }
        if (kind === 'combobox') {
          button.className = 'combobox-option fixture-row';
          return button;
        }
        if (kind === 'group') {
          button.className = 'group-selector-item fixture-row';
          return button;
        }

        const wrapper = globalThis.document.createElement(kind === 'search' ? 'li' : 'section');
        if (kind === 'oncall') wrapper.className = 'oncall-masonry-item fixture-team-card';
        if (kind === 'search') wrapper.className = 'search-dropdown-item fixture-row';
        if (kind === 'detail') wrapper.className = 'detail-panel-field fixture-detail-section';
        button.className = kind === 'search' ? 'search-dropdown-hitbox' : 'tactile-button';
        wrapper.append(button);
        return wrapper;
      };

      for (const target of globalThis.document.querySelectorAll('[data-row-kind]')) {
        if (!(target instanceof globalThis.HTMLElement)) continue;
        const kind = target.dataset.rowKind;
        if (!kind) continue;
        for (let index = 0; index < 12; index += 1) {
          target.append(makeRow(kind, index));
        }
        const finalRow = target.lastElementChild;
        if (finalRow instanceof globalThis.HTMLElement) finalRow.dataset.lastRow = 'true';
      }

      const error = globalThis.document.querySelector('[data-horizontal-contract]');
      if (error) error.textContent = `Error: ${'unbroken'.repeat(100)}`;
    });

    const after = {
      overlay: await capture('overlay', true),
      classic: await capture('classic', true),
    };
    const findSnapshot = (
      collection: (typeof before.overlay)['snapshots'],
      id: string | undefined,
    ) => collection.find((snapshot) => snapshot.id === id);
    const expectScrolledToEnd = (
      snapshot: ReturnType<typeof findSnapshot>,
      label: string,
    ): void => {
      expect(snapshot, label).toBeDefined();
      if (!snapshot) return;

      // scrollTop preserves subpixels while scrollHeight and clientHeight are rounded integers.
      expect(Math.abs(snapshot.scrollTop - snapshot.maxScrollTop), label).toBeLessThanOrEqual(1);
    };

    expect(before.overlay.snapshots).toHaveLength(7);
    expect(before.classic.snapshots).toHaveLength(7);
    expect(after.overlay.snapshots).toHaveLength(7);
    expect(after.classic.snapshots).toHaveLength(7);
    expect(before.classic.wideNativeGutterSimulation).toEqual({
      nativeGutter: 24,
      emulatedGutter: 0,
      totalClassicGutter: 24,
    });
    for (const phase of [before.classic, after.classic]) {
      for (const snapshot of phase.snapshots) {
        expect(snapshot.emulatedGutter, snapshot.id).toBe(
          Math.max(0, classicScrollbarWidth - snapshot.nativeGutter),
        );
        expect(snapshot.totalClassicGutter, snapshot.id).toBe(
          Math.max(snapshot.nativeGutter, classicScrollbarWidth),
        );
      }
    }
    for (const phase of [before.classic, after.classic]) {
      expect(phase.error.emulatedGutter).toBe(
        Math.max(0, classicScrollbarWidth - phase.error.nativeGutter),
      );
      expect(phase.error.totalClassicGutter).toBe(
        Math.max(phase.error.nativeGutter, classicScrollbarWidth),
      );
      expect(phase.error.blockEndBorderWidth).toBe(
        phase.error.nativeBlockEndBorder + phase.error.emulatedGutter,
      );
    }
    [before, after].forEach((phase) => {
      expect(phase.classic.error.clientWidth).toBe(phase.overlay.error.clientWidth);
      expect(phase.classic.error.clientHeight).toBe(
        phase.overlay.error.clientHeight - phase.classic.error.emulatedGutter,
      );
      expect(phase.classic.error.offsetWidth).toBe(phase.overlay.error.offsetWidth);
      expect(phase.classic.error.offsetHeight).toBe(phase.overlay.error.offsetHeight);
    });
    for (const mode of ['overlay', 'classic'] as const) {
      const oncallAtTop = findSnapshot(before[mode].snapshots, 'oncall-root');
      const oncallAtEnd = findSnapshot(after[mode].snapshots, 'oncall-root');
      expect(oncallAtTop?.scrollTop, `${mode} oncall root top`).toBe(0);
      expect(oncallAtTop?.leadingControlVisible, `${mode} oncall root header`).toBe(true);
      expectScrolledToEnd(oncallAtEnd, `${mode} oncall root max`);
      expect(oncallAtEnd?.terminalContentVisible, `${mode} oncall root tail`).toBe(true);
    }
    expect(
      Object.fromEntries(
        before.overlay.snapshots.map(({ id, inlineEndBorderWidth }) => [id, inlineEndBorderWidth]),
      ),
    ).toEqual({
      assembler: 0,
      'oncall-root': 0,
      'oncall-masonry': 0,
      combobox: 1,
      'group-list': 0,
      'search-results': 0,
      'detail-body': 0,
    });
    const expectOverlayHostClientWidths = () => {
      if (!before.overlay.snapshots.every(({ nativeGutter }) => nativeGutter === 0)) return;
      expect(
        Object.fromEntries(
          before.classic.snapshots.map(({ id, clientWidth }) => [id, clientWidth]),
        ),
      ).toEqual({
        assembler: 263,
        'oncall-root': 424,
        'oncall-masonry': 360,
        combobox: 282,
        'group-list': 284,
        'search-results': 402,
        'detail-body': 303,
      });
    };
    expectOverlayHostClientWidths();

    for (const mode of ['overlay', 'classic'] as const) {
      for (const beforeSnapshot of before[mode].snapshots) {
        const afterSnapshot = findSnapshot(after[mode].snapshots, beforeSnapshot.id);
        expect(afterSnapshot, `${mode} ${beforeSnapshot.id}`).toBeDefined();
        expect(beforeSnapshot.scrollbarGutter, `${mode} ${beforeSnapshot.id}`).toBe('stable');
        expect(afterSnapshot?.scrollbarGutter, `${mode} ${beforeSnapshot.id}`).toBe('stable');
        expect(afterSnapshot?.clientWidth, `${mode} ${beforeSnapshot.id}`).toBe(
          beforeSnapshot.clientWidth,
        );
        expect(afterSnapshot?.offsetWidth, `${mode} ${beforeSnapshot.id}`).toBe(
          beforeSnapshot.offsetWidth,
        );
        expect(beforeSnapshot.controlsWithinClientWidth, `${mode} ${beforeSnapshot.id}`).toBe(true);
        expect(afterSnapshot?.controlsWithinClientWidth, `${mode} ${beforeSnapshot.id}`).toBe(true);
      }
    }

    for (const overlaySnapshot of before.overlay.snapshots) {
      const classicSnapshot = findSnapshot(before.classic.snapshots, overlaySnapshot.id);
      const outerOncall = findSnapshot(before.classic.snapshots, 'oncall-root');
      const nestedParentReduction =
        overlaySnapshot.id === 'oncall-masonry' ? (outerOncall?.emulatedGutter ?? 0) : 0;
      const ownClassicReduction = classicSnapshot?.emulatedGutter ?? 0;
      expect(classicSnapshot?.inlineEndBorderWidth, overlaySnapshot.id).toBe(
        (classicSnapshot?.nativeInlineEndBorder ?? 0) + ownClassicReduction,
      );
      expect(classicSnapshot?.offsetWidth, overlaySnapshot.id).toBe(
        overlaySnapshot.offsetWidth - nestedParentReduction,
      );
      expect(classicSnapshot?.clientWidth, overlaySnapshot.id).toBe(
        overlaySnapshot.clientWidth - ownClassicReduction - nestedParentReduction,
      );
    }

    const scrollableIds = [
      'assembler',
      'oncall-root',
      'oncall-masonry',
      'combobox',
      'group-list',
      'search-results',
      'detail-body',
    ];
    for (const mode of ['overlay', 'classic'] as const) {
      for (const id of scrollableIds) {
        const result = findSnapshot(after[mode].snapshots, id);
        expect(result?.overflowY, `${mode} ${id}`).toBe('auto');
        expect(result?.scrollHeight, `${mode} ${id}`).toBeGreaterThan(
          result?.clientHeight ?? Number.MAX_SAFE_INTEGER,
        );
        expectScrolledToEnd(result, `${mode} ${id} max`);
        expect(result?.scrollTop, `${mode} ${id}`).toBeGreaterThan(0);
        expect(result?.terminalContentVisible, `${mode} ${id}`).toBe(true);
      }
      expect(findSnapshot(after[mode].snapshots, 'assembler')?.overflowX).toBe('hidden');
      expect(findSnapshot(after[mode].snapshots, 'oncall-root')?.controlsWithinClientWidth).toBe(
        true,
      );
    }

    for (const mode of ['overlay', 'classic'] as const) {
      expect(after[mode].error).toMatchObject({
        clientWidth: before[mode].error.clientWidth,
        offsetWidth: before[mode].error.offsetWidth,
        overflowX: 'auto',
        controlLeft: before[mode].error.controlLeft,
        controlWidth: before[mode].error.controlWidth,
      });
      expect(after[mode].error.scrollWidth, mode).toBeGreaterThan(after[mode].error.clientWidth);
      expect(after[mode].error.scrollLeft, mode).toBe(after[mode].error.maxScrollLeft);
      expect(after[mode].error.scrollLeft, mode).toBeGreaterThan(0);
    }
  } finally {
    await app.close();
  }
});

test('Radar status keeps the standard sidebar footprint in full and compact shells', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${sidebarCss}
        ${responsiveCss}
        html, body { margin: 0; }
      </style>
      <div>
        <button class="sidebar-button" data-kind="ordinary">
          <span class="sidebar-button-icon"><svg></svg></span>
          <span class="sidebar-button-label">Problems</span>
        </button>
        <button
          class="sidebar-button sidebar-button--status sidebar-button--active"
          data-kind="radar"
          data-status-tone="yellow"
        >
          <span class="sidebar-button-icon"><svg></svg></span>
          <span class="sidebar-button-label">Radar</span>
          <span
            class="sidebar-button-status-dot"
            data-status-tone="yellow"
            aria-hidden="true"
          ></span>
        </button>
      </div>
    `);

    const ordinaryButton = window.locator('[data-kind="ordinary"]');
    const radarButton = window.locator('[data-kind="radar"]');
    const ordinaryIcon = ordinaryButton.locator('.sidebar-button-icon');
    const radarIcon = radarButton.locator('.sidebar-button-icon');
    const ordinaryLabel = ordinaryButton.locator('.sidebar-button-label');
    const radarLabel = radarButton.locator('.sidebar-button-label');
    const pip = radarButton.locator('.sidebar-button-status-dot');

    const relativePosition = async (button: typeof ordinaryButton, child: typeof ordinaryIcon) => {
      const buttonBox = await button.boundingBox();
      const childBox = await child.boundingBox();
      return {
        x: (childBox?.x ?? 0) - (buttonBox?.x ?? 0),
        y: (childBox?.y ?? 0) - (buttonBox?.y ?? 0),
      };
    };

    const expectMatchingButtons = async (width: number, height: number) => {
      const ordinaryBox = await ordinaryButton.boundingBox();
      const radarBox = await radarButton.boundingBox();
      expect(ordinaryBox && { width: ordinaryBox.width, height: ordinaryBox.height }).toEqual({
        width,
        height,
      });
      expect(radarBox && { width: radarBox.width, height: radarBox.height }).toEqual({
        width,
        height,
      });
      expect(await relativePosition(radarButton, radarIcon)).toEqual(
        await relativePosition(ordinaryButton, ordinaryIcon),
      );

      const pipBox = await pip.boundingBox();
      expect(pipBox).not.toBeNull();
      expect(pipBox && { width: pipBox.width, height: pipBox.height }).toEqual({
        width: 10,
        height: 10,
      });
      expect((pipBox?.x ?? 0) + (pipBox?.width ?? 0)).toBeLessThanOrEqual(
        (radarBox?.x ?? 0) + (radarBox?.width ?? 0),
      );
      expect(
        Math.abs((pipBox?.y ?? 0) + (pipBox?.height ?? 0) / 2 - ((radarBox?.y ?? 0) + height / 2)),
      ).toBeLessThanOrEqual(1);
    };

    await window.setViewportSize({ width: 1440, height: 900 });
    await expectMatchingButtons(120, 56);
    expect(await relativePosition(radarButton, radarLabel)).toEqual(
      await relativePosition(ordinaryButton, ordinaryLabel),
    );
    await expect(window.locator('.sidebar-button-detail')).toHaveCount(0);

    await window.setViewportSize({ width: 1100, height: 900 });
    await expectMatchingButtons(56, 48);
    await expect(ordinaryLabel).toBeHidden();
    await expect(radarLabel).toBeHidden();
    await expect(pip).toHaveCount(1);
    const compactIconBox = await radarIcon.boundingBox();
    const compactPipBox = await pip.boundingBox();
    expect(
      (compactPipBox?.x ?? 0) - ((compactIconBox?.x ?? 0) + (compactIconBox?.width ?? 0)),
    ).toBeGreaterThanOrEqual(1);
  } finally {
    await app.close();
  }
});

test('Radar keeps the health rail left when wide and stacks without overflow when narrow', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${radarCss}
        html, body { margin: 0; width: 100%; height: 100%; }
        .radar-tab { box-sizing: border-box; width: 100%; height: 100%; }
      </style>
      <div class="radar-tab">
        <div class="radar-workspace">
          <aside class="radar-health-rail">
            <section class="radar-health-section">
              <h3 class="radar-section-title">XCenter</h3>
              <div class="radar-figures">
                <span class="radar-figure-value">2,000</span>
                <span class="radar-figure-value">1,807</span>
              </div>
            </section>
          </aside>
          <section class="radar-dispatcher-lanes">
            <h3 class="radar-section-title">Dispatchers</h3>
            <div class="radar-lane-grid">
              <section class="radar-lane">
                <h4 class="radar-lane-title">prod01</h4>
                <table class="radar-table">
                  <tbody>
                    <tr>
                      <td class="radar-table-name">
                        TRANSACTION.MEMBERSHIPS.RECONCILIATION.EXCEPTION.RETRY.DEAD.LETTER.QUEUE
                      </td>
                      <td class="radar-table-number">12,534</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          </section>
        </div>
      </div>
    `);

    const rail = window.locator('.radar-health-rail');
    const lanes = window.locator('.radar-dispatcher-lanes');
    const tab = window.locator('.radar-tab');

    await window.setViewportSize({ width: 1400, height: 900 });
    const wideRail = await rail.boundingBox();
    const wideLanes = await lanes.boundingBox();
    expect(wideRail).not.toBeNull();
    expect(wideLanes).not.toBeNull();
    expect((wideRail?.x ?? 0) + (wideRail?.width ?? 0)).toBeLessThan(wideLanes?.x ?? 0);

    await window.setViewportSize({ width: 680, height: 900 });
    await expect
      .poll(async () => {
        const [railBox, laneBox] = await Promise.all([rail.boundingBox(), lanes.boundingBox()]);
        return Boolean(railBox && laneBox && railBox.y + railBox.height <= laneBox.y);
      })
      .toBe(true);
    await expect
      .poll(async () => tab.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});

test('tab chrome toolbar geometry and Header Search actions stay aligned', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    const tabs = [
      {
        name: 'Compose',
        utility: ['Reset', 'History'],
        workflow: ['Copy Recipients', 'Open Teams Draft'],
      },
      {
        name: 'Alerts',
        utility: ['History'],
        workflow: ['Save Image', 'Open in Outlook', 'More alert actions'],
      },
      { name: 'On-Call', utility: ['Copy All', 'Export'], workflow: ['Unlocked', 'Add Card'] },
      { name: 'Knowledge', utility: [], workflow: [] },
      { name: 'Status', utility: ['Refresh'], workflow: [] },
      { name: 'Problems', utility: ['Open', 'Acknowledged', 'Refresh'], workflow: [] },
      { name: 'Radar', utility: ['Open Radar', 'Refresh'], workflow: [] },
    ] as const;
    const button = (label: string, iconOnly = false) =>
      `<button class="tactile-button tactile-button--secondary${
        iconOnly ? ' tactile-button--icon-only' : ''
      }" type="button" aria-label="${label}">${iconOnly ? '<svg></svg>' : label}</button>`;
    const tabMarkup = ({ name, utility, workflow }: (typeof tabs)[number]): string => {
      const overflowMarkup = name === 'Compose' ? button('More Compose actions', true) : '';
      const workflowMarkup = workflow.length
        ? `<div class="tab-command-group tab-command-group--workflow">
            ${workflow.map((label) => button(label, label.startsWith('More '))).join('')}
            ${overflowMarkup}
          </div>`
        : '';
      const utilityMarkup = utility.length
        ? `<div class="tab-command-group tab-command-group--utility">
            ${utility.map((label) => button(label, label === 'Refresh')).join('')}
          </div>`
        : '';
      const groupsMarkup = `${utilityMarkup}${workflowMarkup}`;
      const toolbarContent = ['Compose', 'On-Call'].includes(name)
        ? `<div class="collapsible-header collapsible-header--expanded">
            <div class="collapsible-header-right collapsible-header-right--expanded">
              <div class="collapsible-header-actions collapsible-header-actions--expanded">
                ${groupsMarkup}
              </div>
            </div>
          </div>`
        : groupsMarkup;
      const commandBarMarkup =
        utility.length || workflow.length
          ? `<div class="tab-command-bar" role="toolbar" aria-label="${name} actions">
              ${toolbarContent}
            </div>`
          : '';
      let metadataMarkup = '12 records · Updated August 6, 2026 at 10:09 AM';
      if (name === 'Alerts') {
        metadataMarkup = `<span class="tab-page-status">
          <span class="tab-page-status__dot"></span>
          Draft · INFO
        </span>`;
      } else if (name === 'Radar') {
        metadataMarkup = `<span class="tab-page-status">
          <span class="tab-page-status__dot"></span>
          Healthy
        </span>`;
      }

      return `<section class="tab-contract" data-tab="${name}">
        <header class="tab-page-header">
          <div class="tab-page-header__identity">
            <div class="tab-page-header__context">${name}</div>
            <h2 class="tab-page-header__title">${name} Operational Workspace</h2>
          </div>
          <div class="tab-page-header__meta">
            ${metadataMarkup}
          </div>
        </header>
        ${commandBarMarkup}
        <div class="tab-contract-canvas"></div>
      </section>`;
    };

    await window.setViewportSize({ width: 960, height: 900 });
    await window.setContent(`
      <style>
        ${themeCss}
        ${componentsCss}
        ${tabChromeCss}
        ${modalsCss}
        html, body { margin: 0; background: var(--color-bg-app); color: var(--color-text-primary); }
        .tab-contract-host { display: grid; gap: 24px; padding: 24px; }
        .tab-contract { display: grid; width: min(920px, calc(100vw - 48px)); gap: 16px; }
        .tab-contract-canvas { min-height: 20px; border-top: 1px solid var(--color-border); }
        .search-contract { width: min(540px, calc(100vw - 48px)); }
        .search-dropdown { position: relative; width: 100%; }
      </style>
      <main class="tab-contract-host">
        ${tabs.map(tabMarkup).join('')}

        <section class="search-contract">
          <div class="search-dropdown">
            <ul class="search-dropdown-results" role="listbox">
              <li class="search-dropdown-item is-selected" role="option" aria-selected="true">
                <div class="search-dropdown-result-row has-secondary-action">
                  <button class="search-dropdown-hitbox" type="button">
                    <span class="search-dropdown-result-icon">A</span>
                    <span class="search-dropdown-result-info">
                      <span class="search-dropdown-result-title">Andrew Park With A Long Dispatcher Name</span>
                      <span class="search-dropdown-result-subtitle">andrew.park@example.com</span>
                    </span>
                    <span class="search-dropdown-action-rail" aria-hidden="true">
                      <span class="search-dropdown-result-verb">Open</span>
                    </span>
                  </button>
                  <button class="search-dropdown-secondary-action" type="button" aria-label="Add Andrew Park to bridge">
                    + Bridge
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </main>
    `);

    for (const tab of tabs) {
      const section = window.locator(`[data-tab="${tab.name}"]`);
      const header = section.locator('.tab-page-header');
      await expect(header).toBeVisible();

      const headerGeometry = await header.evaluate((element) => {
        const title = element.querySelector('.tab-page-header__title')?.getBoundingClientRect();
        const meta = element.querySelector('.tab-page-header__meta')?.getBoundingClientRect();
        if (!title || !meta) throw new Error('Missing shared header geometry');
        return {
          overlaps: !(
            title.right <= meta.left ||
            meta.right <= title.left ||
            title.bottom <= meta.top ||
            meta.bottom <= title.top
          ),
        };
      });
      expect(headerGeometry.overlaps, `${tab.name} title and metadata must not overlap`).toBe(
        false,
      );

      const toolbar = section.getByRole('toolbar', { name: `${tab.name} actions` });
      if (tab.name === 'Knowledge') {
        await expect(toolbar).toHaveCount(0);
        continue;
      }
      await expect(toolbar).toBeVisible();
      const geometry = await toolbar.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        groupsShareRow: (() => {
          const utility = element
            .querySelector('.tab-command-group--utility')
            ?.getBoundingClientRect();
          const workflow = element
            .querySelector('.tab-command-group--workflow')
            ?.getBoundingClientRect();
          return (
            !utility ||
            !workflow ||
            Math.abs(utility.top + utility.height / 2 - (workflow.top + workflow.height / 2)) <= 1
          );
        })(),
        utilityHeights: Array.from(
          element.querySelectorAll('.tab-command-group--utility .tactile-button'),
          (button) => button.getBoundingClientRect().height,
        ),
        workflowHeights: Array.from(
          element.querySelectorAll('.tab-command-group--workflow .tactile-button'),
          (button) => button.getBoundingClientRect().height,
        ),
      }));
      expect(geometry.scrollWidth, `${tab.name} toolbar overflow`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );
      expect(geometry.groupsShareRow, `${tab.name} toolbar stacked despite available room`).toBe(
        true,
      );
      expect(geometry.utilityHeights, `${tab.name} utility button count`).toHaveLength(
        tab.utility.length,
      );
      expect(geometry.utilityHeights.every((height) => height === 36)).toBe(true);
      const expectedWorkflowCount = tab.workflow.length + (tab.name === 'Compose' ? 1 : 0);
      expect(geometry.workflowHeights, `${tab.name} workflow button count`).toHaveLength(
        expectedWorkflowCount,
      );
      expect(geometry.workflowHeights.every((height) => height === 40)).toBe(true);
    }

    const composeToolbar = window.getByRole('toolbar', { name: 'Compose actions' });
    const composeGroups = composeToolbar.locator('.tab-command-group');
    await expect(composeGroups).toHaveCount(2);
    await expect(composeToolbar).toHaveCSS('flex-wrap', 'nowrap');
    for (const group of await composeGroups.all()) {
      await expect(group).toHaveCSS('flex-wrap', 'nowrap');
    }

    await window.setViewportSize({ width: 700, height: 900 });
    await expect(composeToolbar).toHaveCSS('flex-wrap', 'wrap');
    for (const group of await composeGroups.all()) {
      await expect(group).toHaveCSS('flex-wrap', 'wrap');
    }

    const overflow = window.getByRole('button', { name: 'More Compose actions' });
    const overflowBox = await overflow.boundingBox();
    expect([overflowBox?.width, overflowBox?.height]).toEqual([40, 40]);

    const alertToolbar = window.locator('[data-tab="Alerts"] .tab-command-bar');
    const alertUtility = alertToolbar.locator('.tab-command-group--utility');
    const alertButtonLabels = await alertToolbar
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
      );
    expect(alertButtonLabels).toEqual([
      'History',
      'Save Image',
      'Open in Outlook',
      'More alert actions',
    ]);
    const alertAlignment = await alertToolbar.evaluate((element) => {
      const toolbar = element.getBoundingClientRect();
      const utility = element.querySelector('.tab-command-group--utility')?.getBoundingClientRect();
      const workflow = element
        .querySelector('.tab-command-group--workflow')
        ?.getBoundingClientRect();
      if (!utility) throw new Error('Missing Alert utility geometry');
      if (!workflow) throw new Error('Missing Alert workflow geometry');
      return {
        utilityLeft: Math.abs(toolbar.left - utility.left),
        workflowRight: Math.abs(toolbar.right - workflow.right),
      };
    });
    expect(alertAlignment.utilityLeft).toBeLessThanOrEqual(1);
    expect(alertAlignment.workflowRight).toBeLessThanOrEqual(1);
    await expect(alertUtility.getByRole('button', { name: 'History' })).toBeVisible();

    for (const name of ['Alerts', 'Radar']) {
      const status = window.locator(`[data-tab="${name}"] .tab-page-status`);
      const statusGeometry = await status.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        const dot = element.querySelector('.tab-page-status__dot')?.getBoundingClientRect();
        return {
          display: style.display,
          padding: style.padding,
          borderWidth: style.borderWidth,
          dotWidth: dot?.width,
          dotHeight: dot?.height,
        };
      });
      expect(statusGeometry).toEqual({
        display: 'flex',
        padding: '0px',
        borderWidth: '0px',
        dotWidth: 8,
        dotHeight: 8,
      });
    }

    const searchBounds = await window.locator('.search-dropdown').evaluate((dropdown) => {
      const bounds = dropdown.getBoundingClientRect();
      const selectors = [
        '.search-dropdown-result-info',
        '.search-dropdown-result-title',
        '.search-dropdown-result-subtitle',
        '.search-dropdown-action-rail',
        '.search-dropdown-secondary-action',
      ];
      return selectors.map((selector) => {
        const element = dropdown.querySelector(selector);
        if (!(element instanceof globalThis.HTMLElement)) throw new Error(`Missing ${selector}`);
        const rect = element.getBoundingClientRect();
        return {
          selector,
          inside: rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1,
        };
      });
    });
    expect(searchBounds).toEqual(searchBounds.map(({ selector }) => ({ selector, inside: true })));

    await window.setViewportSize({ width: 680, height: 900 });
    for (const tab of tabs.filter(({ name }) => name !== 'Knowledge')) {
      const toolbar = window.getByRole('toolbar', { name: `${tab.name} actions` });
      const constrained = await toolbar.evaluate((element) => {
        const utility = element.querySelector('.tab-command-group--utility');
        const workflow = element.querySelector('.tab-command-group--workflow');
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          utilityPrecedesWorkflow:
            !utility ||
            !workflow ||
            Boolean(
              utility?.compareDocumentPosition(workflow) &
              globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
            ),
        };
      });
      expect(
        constrained.scrollWidth,
        `${tab.name} constrained toolbar overflow`,
      ).toBeLessThanOrEqual(constrained.clientWidth);
      expect(constrained.utilityPrecedesWorkflow, `${tab.name} command order`).toBe(true);
    }
  } finally {
    await app.close();
  }
});
