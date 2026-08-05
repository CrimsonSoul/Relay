import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
} from '@playwright/test';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const mainEntry = join(root, 'dist/main/index.js');
const TEST_PASSPHRASE = ['relay', 'web', 'e2e', 'passphrase'].join('-');

type RelayWebFixture = {
  origin: string;
  pocketBaseOrigin: string;
};

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP port.');
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function stopElectron(app: ElectronApplication | null): Promise<void> {
  if (!app) return;
  try {
    const process = app.process();
    if (!process || process.exitCode === null) await app.close();
  } catch {
    // The application may have already exited during a failed test.
  }
}

const test = base.extend<{ relayWeb: RelayWebFixture }>({
  relayWeb: async ({ browserName: _browserName }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'relay-web-e2e-'));
    let app: ElectronApplication | null = null;
    try {
      const pocketBasePort = await freePort();
      let webPort = await freePort();
      while (webPort === pocketBasePort) webPort = await freePort();
      const dataDir = join(userDataDir, 'data');
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        join(dataDir, 'config.json'),
        JSON.stringify(
          {
            mode: 'server',
            port: pocketBasePort,
            bindHost: '0.0.0.0',
            secret: TEST_PASSPHRASE,
            web: { enabled: true, port: webPort },
          },
          null,
          2,
        ),
        { encoding: 'utf8', mode: 0o600 },
      );

      const launchEnvironment = { ...process.env, NODE_ENV: 'test' };
      delete launchEnvironment.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        args: [`--user-data-dir=${userDataDir}`, mainEntry],
        env: launchEnvironment,
      });
      const desktop = await app.firstWindow();
      await expect(desktop.getByTestId('sidebar-compose')).toBeVisible();
      await use({
        origin: `http://127.0.0.1:${webPort}`,
        pocketBaseOrigin: `http://127.0.0.1:${pocketBasePort}`,
      });
    } finally {
      await stopElectron(app);
      await rm(userDataDir, { recursive: true, force: true });
    }
  },
});

test('runs the shared Relay shell with browser-safe behavior @critical', async ({
  page,
  relayWeb,
}, testInfo) => {
  const failedPocketBaseRequests: string[] = [];
  let radarRefreshRequests = 0;
  const radarSnapshot = {
    color: 'green',
    dispatchers: [
      {
        name: 'Prod01',
        tone: 'green',
        lastScheduleDate: '2026-07-31 10:00',
        lastPubSubDate: '2026-07-31 10:00',
        queues: [{ name: 'Work', depth: 4 }],
      },
    ],
    papa: [],
    metrics: [],
    xcenter: { ok: 977, pending: 0 },
    currentTime: '10:00',
    lastUpdated: Date.now(),
    signInRequired: false,
    error: null,
  } as const;
  await page.route('**/relay-api/v1/operations/radar**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/operations/radar/refresh') && request.method() === 'POST') {
      radarRefreshRequests += 1;
      await route.fulfill({ status: 200, json: radarSnapshot });
      return;
    }
    if (pathname.endsWith('/operations/radar') && request.method() === 'GET') {
      await route.fulfill({ status: 200, json: radarSnapshot });
      return;
    }
    await route.continue();
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(relayWeb.pocketBaseOrigin)) {
      failedPocketBaseRequests.push(
        `${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
      );
    }
  });

  await expect
    .poll(async () => {
      try {
        return (await fetch(relayWeb.origin)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);

  const bootstrapResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/relay-api/v1/session/bootstrap'),
  );
  await page.goto(relayWeb.origin);
  const bootstrapResponse = await bootstrapResponsePromise;
  const unauthenticatedBootstrap = {
    status: bootstrapResponse.status(),
    body: (await bootstrapResponse.json()) as unknown,
  };
  expect(unauthenticatedBootstrap).toEqual({
    status: 401,
    body: { ok: false, error: 'unauthenticated' },
  });
  await expect(page.getByRole('heading', { name: 'Relay Web' })).toBeVisible();
  await page.getByLabel('Connection passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByTestId('sidebar-compose')).toBeVisible();
  await expect(page.getByLabel('Relay Web connection notice')).toContainText('Web');
  await expect(page.getByLabel('Relay Web connection notice')).toContainText(
    'Trusted LAN/VPN only - browser traffic is not encrypted',
  );
  await expect(page.locator('.window-controls')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as typeof globalThis & { api?: { runtime?: { kind?: string } } }).api?.runtime
            ?.kind,
      ),
    )
    .toBe('web');
  const webCapabilities = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          api?: { runtime?: { capabilities?: Record<string, boolean> } };
        }
      ).api?.runtime?.capabilities,
  );
  expect(webCapabilities).toMatchObject({
    connectionConfiguration: false,
    pocketBaseRecovery: false,
    offlineCache: false,
    offlineMutations: false,
    nativeWindowControls: false,
    customReminderSound: false,
    imageClipboard: false,
  });

  const browserFamily = { chrome: 'Chrome', edge: 'Edge', safari: 'Safari' }[testInfo.project.name];
  expect(browserFamily).toBeTruthy();
  const clients = page.getByTestId('sidebar-clients');
  try {
    await expect(clients).toHaveAttribute('data-client-count', '1');
  } catch (error) {
    const nodeHealth = await fetch(`${relayWeb.pocketBaseOrigin}/api/health`)
      .then((response) => `status:${response.status}`)
      .catch((cause: unknown) => `error:${String(cause)}`);
    const browserHealth = await page.evaluate(async (origin) => {
      try {
        const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
        return `status:${response.status}`;
      } catch (cause) {
        return `error:${String(cause)}`;
      }
    }, relayWeb.pocketBaseOrigin);
    throw new Error(
      `Browser presence unavailable; Node health=${nodeHealth}; browser health=${browserHealth}; failures=${failedPocketBaseRequests.join(' | ') || 'none'}`,
      { cause: error },
    );
  }
  await clients.hover();
  await expect(page.getByText(`Web · ${browserFamily} · 127.0.0.1`)).toBeVisible();

  const destinations = [
    ['Alerts', 'Alerts'],
    ['On-Call', 'On-Call'],
    ['Knowledge', 'Knowledge'],
    ['Status', 'Service Status'],
    ['Problems', 'Dynatrace Problems'],
    ['Radar', 'Dispatcher Radar'],
  ] as const;
  for (const [button, breadcrumb] of destinations) {
    const destinationButton =
      button === 'Radar'
        ? page.getByRole('button', { name: /^Radar(?: — .+)?$/ })
        : page.getByRole('button', { name: button, exact: true });
    await destinationButton.click();
    await expect(page.locator('.header-breadcrumb')).toContainText(`Relay / ${breadcrumb}`);
  }
  await expect(page.getByRole('heading', { name: 'Dispatcher Radar' })).toBeVisible();
  const xcenter = page.getByRole('region', { name: 'XCenter counts' });
  await expect(xcenter).toContainText('977');
  await expect(xcenter).toContainText('0');
  await page.getByRole('button', { name: 'Refresh Radar now' }).click();
  await expect.poll(() => radarRefreshRequests).toBe(1);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Relay data' }).click();
  await expect(
    page.getByText('Connection settings are managed by Relay Desktop on the server.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconfigure...' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Data Manager...' }).click();
  const dataManager = page.getByRole('dialog', { name: 'Data Manager' });
  await expect(dataManager).toBeVisible();
  await expect(dataManager.getByRole('tab', { name: 'Backups' })).toHaveCount(0);
  await dataManager.getByRole('tab', { name: 'Import' }).click();
  await dataManager.getByRole('combobox').selectOption('servers');
  const importedServers = Array.from({ length: 20 }, (_, index) => ({
    name: `Parity Server ${String(index + 1).padStart(2, '0')}`,
    businessArea: 'Relay Web',
    lob: 'Parity',
    comment: `Imported by browser parity test ${index + 1}`,
    owner: '',
    contact: '',
    os: index % 2 === 0 ? 'Windows Server' : 'Linux',
  }));
  const fileChooserPromise = page.waitForEvent('filechooser');
  await dataManager.getByRole('button', { name: 'Import...' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'relay-parity-servers.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedServers)),
  });
  await expect(dataManager.getByText(/^Processed (?:[1-9]|1\d) of 20$/)).toBeVisible();
  await expect(dataManager.getByText(/^Imported \d+ · Updated \d+ · Errors 0$/)).toBeVisible();
  await expect(dataManager.getByText('Imported: 20, Updated: 0, Skipped: 0')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.getByRole('button', { name: /^Open Servers, 20 servers$/ }).click();
  await expect(page.getByRole('button', { name: /^Parity Server 01 / })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Filter servers' }).fill('Parity Server 20');
  await expect(page.getByRole('button', { name: /^Parity Server 20 / })).toBeVisible();

  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await page.getByRole('button', { name: 'More alert actions' }).click();
  await page.getByRole('menuitem', { name: 'Alarms', exact: true }).click();
  const reminderManager = page.getByRole('dialog', { name: 'Alarms' });
  await expect(reminderManager).toBeVisible();
  await expect(reminderManager.getByRole('button', { name: 'Choose MP3' })).toHaveCount(0);
  await reminderManager.getByRole('button', { name: 'Close', exact: true }).click();

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByRole('heading', { name: 'Larger window required' })).toBeVisible();
  await expect(page.getByText('at least 1024 pixels wide')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('sidebar-compose')).toBeVisible();
});
