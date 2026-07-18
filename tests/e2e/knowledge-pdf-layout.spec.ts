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
