import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainEntry = path.join(__dirname, '../fixtures/layoutElectronMain.cjs');
const knowledgeCss = fs.readFileSync(
  path.join(__dirname, '../../src/renderer/src/features/knowledge/knowledge.css'),
  'utf8',
);

const knowledgeTokens = `
  :root {
    --accent: #f44864;
    --accent-bright: #ff8ca0;
    --accent-subtle: rgba(244, 72, 100, 0.14);
    --accent-dim: rgba(244, 72, 100, 0.22);
    --color-bg-app: #09090b;
    --color-bg-surface: #111114;
    --color-bg-surface-2: #19191d;
    --color-bg-surface-3: #222227;
    --color-border: #34343a;
    --color-border-strong: #57575f;
    --color-border-accent: #a93448;
    --color-text-primary: #eee9ec;
    --color-text-secondary: #c8c1c5;
    --color-text-tertiary: #aaa2a7;
    --font-family-mono: ui-monospace, monospace;
    --radius-sm: 4px;
    --space-4: 16px;
    --weight-bold: 700;
  }
`;

const test = base.extend<{ electronApp: ElectronApplication; window: Page }>({
  electronApp: async ({ browserName: _browserName }, use) => {
    const electronApp = await electron.launch({ args: [mainEntry] });
    await use(electronApp);
    await electronApp.close();
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

test('continuous PDF keeps oversized pages reachable and smaller pages centered', async ({
  window,
}) => {
  await window.setContent(`
      <style>
        ${knowledgeCss}
        html, body { margin: 0; }
        .knowledge-continuous-pdf {
          box-sizing: border-box;
          width: 400px;
          height: 260px;
          padding: 20px;
        }
        .knowledge-page-shell { height: 80px; }
      </style>
      <div class="knowledge-continuous-pdf knowledge-viewer__viewport" role="region" aria-label="Continuous PDF pages">
        <div class="knowledge-page-shell" data-testid="large-page-shell" style="width: 800px"></div>
        <div class="knowledge-page-shell" data-testid="small-page-shell" style="width: 200px"></div>
      </div>
    `);

  const viewport = window.getByRole('region', { name: 'Continuous PDF pages' });
  const largePage = window.getByTestId('large-page-shell');
  const smallPage = window.getByTestId('small-page-shell');
  await expect(viewport).toBeVisible();
  await expect(largePage).toBeVisible();
  await expect(smallPage).toBeVisible();

  await expect
    .poll(async () => {
      const [viewportBox, largeBox] = await Promise.all([
        viewport.boundingBox(),
        largePage.boundingBox(),
      ]);
      if (!viewportBox || !largeBox) return null;
      return largeBox.x - viewportBox.x;
    })
    .toBe(20);
  await expect
    .poll(async () => {
      const [viewportBox, smallBox] = await Promise.all([
        viewport.boundingBox(),
        smallPage.boundingBox(),
      ]);
      if (!viewportBox || !smallBox) return null;
      return smallBox.x - viewportBox.x;
    })
    .toBe(100);
  await expect
    .poll(async () => {
      await viewport.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      const [viewportBox, largeBox] = await Promise.all([
        viewport.boundingBox(),
        largePage.boundingBox(),
      ]);
      if (!viewportBox || !largeBox) return null;
      return viewportBox.x + viewportBox.width - (largeBox.x + largeBox.width);
    })
    .toBe(20);
});

test('mode control preserves keyboard focus, name, pressed state, and reduced motion', async ({
  window,
}) => {
  await window.setContent(`
    <style>
      ${knowledgeTokens}
      ${knowledgeCss}
      html, body { margin: 0; background: #09090b; }
    </style>
    <section class="knowledge-viewer" aria-label="Guide PDF viewer">
      <header class="knowledge-viewer__toolbar">
        <div class="knowledge-viewer__identity"><h2>Guide</h2></div>
        <div class="knowledge-viewer__controls" aria-label="PDF controls">
          <button class="knowledge-viewer__mode" type="button" aria-pressed="true">View: Continuous</button>
        </div>
      </header>
    </section>
    <script>
      const mode = document.querySelector('.knowledge-viewer__mode');
      mode.addEventListener('click', () => {
        const continuous = mode.getAttribute('aria-pressed') === 'true';
        mode.setAttribute('aria-pressed', String(!continuous));
        mode.textContent = continuous ? 'View: Single page' : 'View: Continuous';
      });
    </script>
  `);

  const continuousMode = window.getByRole('button', { name: 'View: Continuous' });
  await expect(continuousMode).toHaveCount(1);
  await expect(continuousMode).toHaveAttribute('aria-pressed', 'true');
  await continuousMode.focus();
  await expect(continuousMode).toBeFocused();
  await expect(continuousMode).toHaveCSS('outline-style', 'solid');
  await expect(continuousMode).toHaveCSS('transition-duration', /0\.18s/);

  await window.keyboard.press('Enter');
  const singleMode = window.getByRole('button', { name: 'View: Single page' });
  await expect(singleMode).toHaveAttribute('aria-pressed', 'false');
  await expect(singleMode).toBeFocused();

  await window.keyboard.press('Space');
  await expect(continuousMode).toHaveAttribute('aria-pressed', 'true');
  await expect(continuousMode).toBeFocused();

  await window.emulateMedia({ reducedMotion: 'reduce' });
  await expect(continuousMode).toHaveCSS('transition-duration', /0s/);
});

test('compact Wiki library uses a container drawer without changing desktop layout', async ({
  window,
}) => {
  await window.setViewportSize({ width: 1200, height: 800 });
  await window.setContent(`
    <style>
      ${knowledgeTokens}
      ${knowledgeCss}
      html, body { margin: 0; background: #09090b; }
      .knowledge-tab { width: 880px; height: 700px; }
    </style>
    <div class="knowledge-tab" data-testid="knowledge-tab">
      <div class="knowledge-workspace" data-testid="workspace" data-library-drawer="closed">
        <button
          type="button"
          class="knowledge-library-toggle"
          aria-label="Wiki library"
          aria-controls="knowledge-library-drawer"
          aria-expanded="false"
        >Library</button>
        <button
          type="button"
          class="knowledge-drawer-backdrop"
          aria-label="Close Wiki library backdrop"
          tabindex="-1"
        ></button>
        <aside id="knowledge-library-drawer" class="knowledge-drawer" aria-label="Wiki library">
          <div class="knowledge-drawer__heading">
            <div class="knowledge-drawer__title"><span>Operational reference</span><h1>Wiki</h1></div>
            <button type="button" class="knowledge-drawer__close" aria-label="Close Wiki library">×</button>
          </div>
        </aside>
        <section class="knowledge-viewer" data-testid="reader">
          <header class="knowledge-viewer__toolbar"><div class="knowledge-viewer__identity"><h2>Guide</h2></div></header>
        </section>
      </div>
    </div>
    <script>
      const workspace = document.querySelector('.knowledge-workspace');
      const toggle = document.querySelector('.knowledge-library-toggle');
      const close = () => {
        workspace.dataset.libraryDrawer = 'closed';
        toggle.setAttribute('aria-expanded', 'false');
      };
      toggle.addEventListener('click', () => {
        workspace.dataset.libraryDrawer = 'open';
        toggle.setAttribute('aria-expanded', 'true');
      });
      document.querySelector('.knowledge-drawer__close').addEventListener('click', close);
      document.querySelector('.knowledge-drawer-backdrop').addEventListener('click', close);
    </script>
  `);

  const tab = window.getByTestId('knowledge-tab');
  const workspace = window.getByTestId('workspace');
  const reader = window.getByTestId('reader');
  const drawer = window.getByRole('complementary', { name: 'Wiki library' });
  const toggle = window.getByRole('button', { name: 'Wiki library', exact: true });

  await expect(toggle).toBeVisible();
  await expect(drawer).toBeHidden();
  await expect
    .poll(async () => {
      const [workspaceBox, readerBox] = await Promise.all([
        workspace.boundingBox(),
        reader.boundingBox(),
      ]);
      if (!workspaceBox || !readerBox) return null;
      return Math.round(readerBox.width) === Math.round(workspaceBox.width);
    })
    .toBe(true);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer).toBeVisible();

  await tab.evaluate((element) => {
    element.style.width = '1040px';
  });
  await expect(toggle).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => {
      const [workspaceBox, readerBox, drawerBox] = await Promise.all([
        workspace.boundingBox(),
        reader.boundingBox(),
        drawer.boundingBox(),
      ]);
      if (!workspaceBox || !readerBox || !drawerBox) return null;
      return Math.round(readerBox.width + drawerBox.width) === Math.round(workspaceBox.width);
    })
    .toBe(true);
});

test('narrow reader controls and fitted page content stay contained and readable', async ({
  window,
}) => {
  await window.setViewportSize({ width: 360, height: 520 });
  await window.setContent(`
    <style>
      ${knowledgeTokens}
      ${knowledgeCss}
      html, body { width: 100%; height: 100%; margin: 0; background: #09090b; }
      .knowledge-viewer { width: 100%; height: 100%; }
      .knowledge-continuous-pdf { box-sizing: border-box; padding: 20px; }
      .knowledge-page-shell { width: 240px; min-height: 100px; }
    </style>
    <section class="knowledge-viewer" aria-label="Guide PDF viewer">
      <header class="knowledge-viewer__toolbar" data-testid="toolbar">
        <div class="knowledge-viewer__identity"><h2>A long guide title that must not overflow</h2></div>
        <div class="knowledge-viewer__controls" aria-label="PDF controls" data-testid="controls">
          <button type="button" aria-label="Previous page">←</button>
          <span class="knowledge-viewer__page-status">Page 2 of 12</span>
          <button type="button" aria-label="Next page">→</button>
          <span class="knowledge-viewer__control-divider"></span>
          <span class="knowledge-viewer__zoom">105%</span>
          <button class="knowledge-viewer__fit" type="button">Fit width</button>
          <button class="knowledge-viewer__mode" type="button" aria-pressed="true">View: Continuous</button>
        </div>
      </header>
      <div class="knowledge-continuous-pdf knowledge-viewer__viewport" role="region" aria-label="Continuous PDF pages">
        <div class="knowledge-page-shell" data-testid="placeholder-shell">
          <div class="knowledge-page-placeholder" data-testid="placeholder">2</div>
        </div>
        <div class="knowledge-page-shell" data-testid="error-shell">
          <div class="knowledge-page">
            <div class="knowledge-page__error" role="status"><p>Relay could not render this page.</p></div>
          </div>
        </div>
      </div>
    </section>
  `);

  const toolbar = window.getByTestId('toolbar');
  const controls = window.getByTestId('controls');
  const mode = window.getByRole('button', { name: 'View: Continuous' });
  await expect(window.getByRole('button', { name: 'Fit width' })).toBeHidden();
  await expect(mode).toBeVisible();
  await expect
    .poll(() =>
      controls.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth),
    )
    .toBe(true);
  await expect
    .poll(() => toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
  await expect
    .poll(() => mode.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);

  const placeholderShell = window.getByTestId('placeholder-shell');
  const placeholder = window.getByTestId('placeholder');
  const errorShell = window.getByTestId('error-shell');
  const pageError = window.getByRole('status');
  await expect
    .poll(async () => {
      const [shellBox, placeholderBox] = await Promise.all([
        placeholderShell.boundingBox(),
        placeholder.boundingBox(),
      ]);
      if (!shellBox || !placeholderBox) return null;
      return placeholderBox.width <= shellBox.width;
    })
    .toBe(true);
  await expect
    .poll(async () => {
      const [shellBox, errorBox] = await Promise.all([
        errorShell.boundingBox(),
        pageError.boundingBox(),
      ]);
      if (!shellBox || !errorBox) return null;
      return errorBox.width <= shellBox.width;
    })
    .toBe(true);
});
