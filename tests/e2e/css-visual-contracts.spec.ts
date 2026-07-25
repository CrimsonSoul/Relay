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

test('standard scroll containers preserve vertical reachability and narrow scrollbar styling', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    const selectors = [
      'detail-panel-body',
      'popout-board',
      'personnel-tab-root',
      'oncall-masonry',
      'combobox-dropdown',
      'group-selector-list',
      'error-page-stack',
      'search-dropdown-results',
      'assembler-sidebar-panel',
    ];
    await window.setContent(`
      <style>
        ${themeCss}
        ${componentsCss}
        ${scrollCss}
        html, body { margin: 0; }
        .scroll-contract {
          display: block !important;
          width: 120px !important;
          height: 60px !important;
          min-height: 0 !important;
          max-height: 60px !important;
          padding: 0 !important;
        }
        .scroll-content { width: 50px; height: 200px; }
      </style>
      ${selectors
        .map((className) => {
          const container = `<div data-scroll-contract="${className}" class="${className} scroll-contract"><div class="scroll-content"></div></div>`;
          return className === 'assembler-sidebar-panel'
            ? `<div class="assembler-sidebar">${container}</div>`
            : container;
        })
        .join('')}
    `);

    const results = await window.evaluate(() =>
      Array.from(globalThis.document.querySelectorAll('[data-scroll-contract]'), (element) => {
        if (!(element instanceof globalThis.HTMLElement)) {
          throw new Error('Invalid scroll contract element');
        }
        const styles = globalThis.getComputedStyle(element);
        element.scrollTop = 40;
        return {
          selector: element.dataset.scrollContract,
          overflowX: styles.overflowX,
          overflowY: styles.overflowY,
          scrollTop: element.scrollTop,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      }),
    );

    expect(results).toHaveLength(selectors.length);
    expect(
      results.filter(
        ({ overflowY, scrollTop, clientHeight, scrollHeight }) =>
          overflowY !== 'auto' || scrollTop === 0 || scrollHeight <= clientHeight,
      ),
    ).toEqual([]);
    expect(results.find(({ selector }) => selector === 'assembler-sidebar-panel')?.overflowX).toBe(
      'hidden',
    );

    const scrollbarContract = await window.evaluate(() => {
      const probe = globalThis.document.querySelector('[data-scroll-contract]');
      if (!(probe instanceof globalThis.HTMLElement)) throw new Error('Missing scrollbar probe');
      const styles = globalThis.getComputedStyle(probe);
      const webkitScrollbar = globalThis.getComputedStyle(probe, '::-webkit-scrollbar');
      return {
        scrollbarWidth: styles.scrollbarWidth,
        webkitWidth: webkitScrollbar.width,
        webkitHeight: webkitScrollbar.height,
      };
    });
    expect(scrollbarContract).toEqual({
      scrollbarWidth: 'thin',
      webkitWidth: '6px',
      webkitHeight: '6px',
    });
  } finally {
    await app.close();
  }
});
