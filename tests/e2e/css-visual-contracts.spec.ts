import { _electron as electron, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const mainEntry = join(testDirectory, '../fixtures/layoutElectronMain.cjs');
const themeCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/theme.css'),
  'utf8',
);
const componentsCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/components.css'),
  'utf8',
);
const sidebarCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);
const responsiveCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/responsive.css'),
  'utf8',
);
const radarCss = readFileSync(join(testDirectory, '../../src/renderer/src/tabs/radar.css'), 'utf8');
const dynatraceProblemsCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/tabs/dynatrace-problems.css'),
  'utf8',
);
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

test('flagged chips retain WCAG text contrast across every Relay accent and opaque background', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${componentsCss}
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

test('Radar refresh matches the Problems header control and source action stays compact', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${componentsCss}
        ${radarCss}
        ${dynatraceProblemsCss}
        html, body { margin: 0; }
      </style>
      <div class="radar-tab">
        <header class="radar-tab-header">
          <div>
            <div class="radar-tab-context">RADAR</div>
            <h2 class="radar-tab-title">Dispatcher Radar</h2>
          </div>
          <div class="radar-tab-actions">
            <button
              class="tactile-button tactile-button--secondary tactile-button--md radar-header-action"
              type="button"
            >
              ORIGINAL
            </button>
            <button
              class="radar-refresh"
              type="button"
              aria-label="Refresh Radar now"
            >
              <svg width="20" height="20" viewBox="0 0 24 24"></svg>
            </button>
          </div>
        </header>
      </div>
      <div class="dt-problems__sync-meta">
        <button class="dt-problems__refresh" type="button" aria-label="Reference refresh">
          <svg width="20" height="20" viewBox="0 0 24 24"></svg>
        </button>
      </div>
    `);

    const openOriginal = window.locator('.radar-header-action');
    const radarRefresh = window.locator('.radar-refresh');
    const problemsRefresh = window.locator('.dt-problems__refresh');
    await expect(openOriginal).toHaveCount(1);
    await expect(radarRefresh).toHaveCount(1);
    const [openBox, refreshBox] = await Promise.all([
      openOriginal.boundingBox(),
      radarRefresh.boundingBox(),
    ]);
    expect([openBox?.height, refreshBox?.width, refreshBox?.height]).toEqual([40, 40, 40]);
    expect(openBox?.width).toBeLessThanOrEqual(96);

    const comparableStyle = (locator: typeof radarRefresh) =>
      locator.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          alignItems: style.alignItems,
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          borderTopColor: style.borderTopColor,
          display: style.display,
          justifyContent: style.justifyContent,
          padding: style.padding,
        };
      });
    const [radarStyle, problemsStyle] = await Promise.all([
      comparableStyle(radarRefresh),
      comparableStyle(problemsRefresh),
    ]);
    expect(radarStyle).toEqual(problemsStyle);

    expect(
      await radarRefresh.locator('svg').evaluate((icon) => ({
        height: icon.getBoundingClientRect().height,
        width: icon.getBoundingClientRect().width,
      })),
    ).toEqual({ height: 20, width: 20 });
  } finally {
    await app.close();
  }
});
