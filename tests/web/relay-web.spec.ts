import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import crypto from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { buildKnowledgePdfFixture } from '../fixtures/knowledgePdfFixtures';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const mainEntry = join(root, 'dist/main/index.js');
const TEST_PASSPHRASE = ['relay', 'web', 'e2e', 'passphrase'].join('-');

type RelayWebFixture = {
  dataDir: string;
  origin: string;
  pocketBaseOrigin: string;
};

type RelayRoleAccount = {
  id: string;
  username: string;
  displayName: string;
  storedRole: 'administrator' | 'publisher';
  active: boolean;
  mustChangePassword: boolean;
  credentialVersion: number;
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

async function signInRelayWeb(page: Page, relayWeb: RelayWebFixture): Promise<void> {
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
  expect({
    status: bootstrapResponse.status(),
    body: (await bootstrapResponse.json()) as unknown,
  }).toEqual({
    status: 401,
    body: { ok: false, error: 'unauthenticated' },
  });

  await expect(page.getByRole('heading', { name: 'Relay Web' })).toBeVisible();
  await page.getByLabel('Connection passphrase').fill(TEST_PASSPHRASE);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('sidebar-compose')).toBeVisible();
  await expect(page.locator('[data-connection-state="online"]').first()).toBeVisible();
}

async function makeSuperuserPbClient(relayWeb: RelayWebFixture): Promise<PocketBase> {
  const pb = new PocketBase(relayWeb.pocketBaseOrigin);
  await pb.collection('_superusers').authWithPassword('admin@relay.app', TEST_PASSPHRASE, {
    requestKey: null,
  });
  return pb;
}

async function waitForRoleAccount(pb: PocketBase, username: string): Promise<RelayRoleAccount> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await pb
        .collection('relay_privileged_accounts')
        .getFirstListItem<RelayRoleAccount>(`username = "${username}"`, { requestKey: null });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function activateOwnerAccount(pb: PocketBase, password: string): Promise<void> {
  const account = await waitForRoleAccount(pb, 'ryan');
  const updated = await pb.collection('relay_privileged_accounts').update<RelayRoleAccount>(
    account.id,
    {
      active: true,
      mustChangePassword: false,
      credentialVersion: account.credentialVersion + 1,
      password,
      passwordConfirm: password,
    },
    { requestKey: null },
  );
  expect(updated).toMatchObject({
    id: account.id,
    username: 'ryan',
    storedRole: 'administrator',
    active: true,
    mustChangePassword: false,
  });
}

async function readDownload(
  page: Page,
  trigger: () => Promise<void>,
): Promise<{
  bytes: Buffer;
  suggestedFilename: string;
}> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { bytes: Buffer.concat(chunks), suggestedFilename: download.suggestedFilename() };
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
        dataDir,
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
  context,
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

  const pb = await makeSuperuserPbClient(relayWeb);
  await pb.collection('alert_reminders').create(
    {
      title: 'Relay Web overdue alarm',
      note: 'Browser alarm readiness coverage',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'pending',
      snoozeUntil: '',
      severity: 'ISSUE',
      alertSubject: 'Relay Web alarm',
      alertBodyHtml: '<p>Browser alarm readiness coverage</p>',
      alertSender: 'Relay',
      completedAt: '',
      dismissedAt: '',
    },
    { requestKey: null },
  );
  await signInRelayWeb(page, relayWeb);

  const alarmStatus = page.locator('.web-alarm-status');
  await expect(alarmStatus.getByText('1 overdue alarm', { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/^\(1 overdue\) /);
  const dueAlarm = page.getByRole('alertdialog', { name: 'Relay Web overdue alarm' });
  await dueAlarm.getByRole('button', { name: 'Snooze 10m' }).click();
  await expect(dueAlarm).not.toBeVisible();

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

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'About', exact: true }).click();
  const webStatus = page.getByRole('region', { name: 'Relay Web status' });
  await expect(webStatus.getByRole('heading', { name: 'Relay Web status' })).toBeVisible();
  await expect(webStatus.getByText('Session ends by', { exact: true })).toBeVisible();
  await expect(webStatus.getByText('Dynatrace last sync', { exact: true })).toBeVisible();
  await expect(webStatus.getByText('Radar last update', { exact: true })).toBeVisible();
  await webStatus.getByRole('button', { name: 'Refresh status' }).click();
  await expect(webStatus.getByRole('button', { name: 'Refresh status' })).toBeEnabled();
  await page.locator('.settings-page__workspace').evaluate((workspace) => {
    workspace.scrollTop = 0;
  });
  await expect(webStatus.getByRole('heading', { name: 'Relay Web status' })).toBeVisible();
  const aboutScreenshot = testInfo.outputPath('relay-web-about-1280.png');
  await page.screenshot({ path: aboutScreenshot, animations: 'disabled' });
  await testInfo.attach('relay-web-about-1280', {
    path: aboutScreenshot,
    contentType: 'image/png',
  });

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
  await alarmStatus.getByRole('button', { name: 'Test sound' }).click();
  await expect(alarmStatus.getByRole('status')).toHaveText(/Sound (?:available|blocked)/);
  await page.getByRole('button', { name: 'More alert actions' }).click();
  await page.getByRole('menuitem', { name: 'Alarms', exact: true }).click();
  const reminderManager = page.getByRole('dialog', { name: 'Alarms' });
  await expect(reminderManager).toBeVisible();
  await expect(reminderManager.getByRole('button', { name: 'Choose MP3' })).toHaveCount(0);
  await reminderManager.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-modal-layer]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Compose', exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByTestId('sidebar-compose')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Larger window required' })).toHaveCount(0);
  const sidebar = page.locator('.sidebar');
  await expect
    .poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(136);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sidebarElement = globalThis.document.querySelector('.sidebar');
        const label = globalThis.document.querySelector('.web-runtime-banner__label');
        if (!sidebarElement || !label) return null;
        const sidebarBounds = sidebarElement.getBoundingClientRect();
        const labelBounds = label.getBoundingClientRect();
        return {
          sidebarWidth: Math.round(sidebarBounds.width),
          labelStartsAfterSidebar: labelBounds.left >= sidebarBounds.right,
        };
      }),
    )
    .toEqual({
      sidebarWidth: 136,
      labelStartsAfterSidebar: true,
    });

  await page.locator('main.main-content').hover();
  const relaySearch = page.getByRole('combobox', { name: 'Search Relay', exact: true });
  await relaySearch.focus();
  await relaySearch.press('Escape');
  await expect(relaySearch).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(() => sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(64);
  const collapsedLayoutGeometry = await page.evaluate(() => {
    const sidebarElement = globalThis.document.querySelector('.sidebar');
    const main = globalThis.document.querySelector('main.main-content');
    const banner = globalThis.document.querySelector(
      'aside.web-runtime-banner[aria-label="Relay Web connection notice"]',
    );
    const label = globalThis.document.querySelector('.web-runtime-banner__label');
    const statusBar = globalThis.document.querySelector('.status-bar');
    const warning = globalThis.document.querySelector('.web-runtime-banner__warning');
    if (!sidebarElement || !main || !banner || !label || !statusBar || !warning) return null;
    const sidebarBounds = sidebarElement.getBoundingClientRect();
    const mainBounds = main.getBoundingClientRect();
    const first = banner.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    const second = statusBar.getBoundingClientRect();
    const overlapWidth = Math.max(
      0,
      Math.min(first.right, second.right) - Math.max(first.left, second.left),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
    );
    return {
      sidebarWidth: Math.round(sidebarBounds.width),
      mainStartsAfterSidebar: mainBounds.left >= sidebarBounds.right,
      bannerStartsAfterSidebar: first.left >= sidebarBounds.right,
      labelStartsAfterSidebar: labelBounds.left >= sidebarBounds.right,
      overlapArea: overlapWidth * overlapHeight,
      warningFullyVisible:
        warning.scrollWidth <= warning.clientWidth + 1 &&
        warning.scrollHeight <= warning.clientHeight + 1,
      pageFitsViewport: globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    };
  });
  expect(collapsedLayoutGeometry).toEqual({
    sidebarWidth: 64,
    mainStartsAfterSidebar: true,
    bannerStartsAfterSidebar: true,
    labelStartsAfterSidebar: true,
    overlapArea: 0,
    warningFullyVisible: true,
    pageFitsViewport: true,
  });
  await expect(page.locator('.web-runtime-banner__warning')).toHaveText(
    'Trusted LAN/VPN only - browser traffic is not encrypted',
  );
  const composeScreenshot = testInfo.outputPath('relay-web-compose-banner-1024.png');
  await page.screenshot({ path: composeScreenshot, animations: 'disabled' });
  await testInfo.attach('relay-web-compose-banner-1024', {
    path: composeScreenshot,
    contentType: 'image/png',
  });

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByRole('heading', { name: 'Larger window required' })).toBeVisible();
  await expect(page.getByText('at least 1024 pixels wide')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId('sidebar-compose')).toBeVisible();

  const connectionState = page.locator('[data-connection-state]').first();
  await context.setOffline(true);
  try {
    await expect(connectionState).toHaveAttribute(
      'data-connection-state',
      /^(?:offline|reconnecting)$/,
    );
  } finally {
    await context.setOffline(false);
  }
  await expect(connectionState).toHaveAttribute('data-connection-state', 'online');

  await page
    .getByLabel('Relay Web connection notice')
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Relay Web' })).toBeVisible();
  await expect(page.getByTestId('sidebar-compose')).toHaveCount(0);
});

test('runs Compose, On-Call CRUD, and browser alert exports @critical', async ({
  page,
  relayWeb,
}) => {
  test.setTimeout(120_000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const contactName = `Relay Web Compose ${suffix}`;
  const contactEmail = `relay.web.${suffix}@example.com`;
  const pb = await makeSuperuserPbClient(relayWeb);
  await pb.collection('contacts').create(
    {
      name: contactName,
      email: contactEmail,
      title: 'Browser workflow contact',
      phone: '5551234567',
    },
    { requestKey: null },
  );
  await signInRelayWeb(page, relayWeb);

  const search = page.getByRole('combobox', { name: 'Search Relay', exact: true });
  await search.fill(contactEmail);
  await expect(page.getByText(contactName, { exact: true }).first()).toBeVisible();
  await search.press('Enter');
  const recipients = page.getByRole('region', { name: 'Recipients' });
  await expect(recipients.getByText(contactEmail, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open Teams Draft', exact: true }).click();
  const teamsDraft = page.getByRole('dialog', { name: 'Open Teams meeting draft?' });
  await expect(teamsDraft.getByLabel('Teams handoff summary')).toContainText('0 groups · 1 manual');
  await teamsDraft.getByText('View all 1 recipient', { exact: true }).click();
  await expect(teamsDraft.getByText(contactEmail, { exact: true })).toBeVisible();
  await teamsDraft.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'More Compose actions' }).click();
  await page.getByRole('menuitem', { name: 'Create Calendar Invite' }).click();
  const bridge = page.getByRole('dialog', { name: 'Schedule Bridge' });
  await bridge.getByLabel('Subject').fill(`Relay Web bridge ${suffix}`);
  await bridge.getByLabel('Your Email (Organizer)').fill('operator@example.com');
  const ics = await readDownload(page, () =>
    bridge.getByRole('button', { name: 'Create Invite' }).click(),
  );
  expect(ics.suggestedFilename).toBe('relay-schedule.ics');
  const icsText = ics.bytes.toString('utf8').replaceAll(/\r?\n[ \t]/g, '');
  expect(icsText).toContain('BEGIN:VCALENDAR');
  expect(icsText).toContain('SUMMARY:Relay Web bridge');
  expect(icsText).toContain(`mailto:${contactEmail}`);
  expect(icsText).toContain('mailto:operator@example.com');
  expect(icsText).toContain('END:VCALENDAR');
  await expect(page.getByText(/relay-schedule\.ics download started/)).toBeVisible();

  await page.getByRole('button', { name: 'On-Call', exact: true }).click();
  const teamName = `Browser Team ${suffix}`;
  await page.getByRole('button', { name: 'ADD CARD' }).click();
  const addCard = page.getByRole('dialog', { name: /Add New Card/i });
  await addCard.getByPlaceholder(/Card Name/i).fill(teamName);
  await addCard.getByRole('button', { name: 'Add Card' }).click();
  await expect(addCard).not.toBeVisible();

  const teamCard = page.locator('.team-card-body', { hasText: teamName }).first();
  await expect(teamCard).toBeVisible();
  await teamCard.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename Team' }).click();
  const renameCard = page.getByRole('dialog', { name: /Rename Card/i });
  const renamedTeam = `${teamName} Renamed`;
  await renameCard.locator('input').first().fill(renamedTeam);
  await renameCard.getByRole('button', { name: 'Rename' }).click();
  const renamedCard = page.locator('.team-card-body', { hasText: renamedTeam }).first();
  await expect(renamedCard).toBeVisible();
  await renamedCard.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove Team' }).click();
  const removeCard = page.getByRole('dialog', { name: /Remove Card/i });
  await removeCard.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.team-card-body', { hasText: renamedTeam })).toHaveCount(0);

  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  const subject = `Relay Web export ${suffix}`;
  await page.getByLabel(/^Subject /).fill(subject);
  const editor = page.getByRole('textbox', { name: 'Alert body' });
  await editor.fill('Browser alert workflow with an attached image.');

  const pngFixture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const imageChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Insert image' }).click();
  const imageChooser = await imageChooserPromise;
  await imageChooser.setFiles({
    name: 'browser-alert.png',
    mimeType: 'image/png',
    buffer: pngFixture,
  });
  await expect(editor.locator('img[alt="Alert image"]')).toHaveCount(1);

  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(globalThis.atob(base64), (character) => character.charCodeAt(0));
    const transfer = new globalThis.DataTransfer();
    transfer.items.add(new File([bytes], 'dropped-alert.png', { type: 'image/png' }));
    return transfer;
  }, pngFixture.toString('base64'));
  await editor.dispatchEvent('drop', { dataTransfer });
  await dataTransfer.dispose();
  await expect(editor.locator('img[alt="Alert image"]')).toHaveCount(2);

  const png = await readDownload(page, () =>
    page.getByRole('button', { name: 'Save Image' }).click(),
  );
  expect(png.suggestedFilename).toBe(`alert_relay_web_export_${suffix}.png`);
  expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.bytes.byteLength).toBeGreaterThan(1_000);

  const eml = await readDownload(page, () =>
    page.getByRole('button', { name: 'Download Draft' }).click(),
  );
  expect(eml.suggestedFilename).toBe('relay-alert.eml');
  const emlText = eml.bytes.toString('utf8');
  expect(emlText).toContain('X-Unsent: 1');
  expect(emlText).toContain(`Subject: ${subject}`);
  expect(emlText).toContain('Content-ID: <relay-alert-image>');
  expect(emlText).toContain('Content-Disposition: inline; filename="relay-alert.png"');
  await expect(page.getByText(/relay-alert\.eml download started/)).toBeVisible();

  await editor.focus();
  await page.keyboard.press('Meta+1');
  await expect(page.locator('.header-breadcrumb')).toContainText('Relay / Alerts');
  await page.keyboard.press('Alt+Shift+Digit1');
  await expect(page.locator('.header-breadcrumb')).toContainText('Relay / Alerts');
  await page.getByRole('button', { name: 'Alerts', exact: true }).focus();
  await page.keyboard.press('Meta+1');
  await expect(page.locator('.header-breadcrumb')).toContainText('Relay / Alerts');
  await page.keyboard.press('Alt+Shift+Digit1');
  await expect(page.locator('.header-breadcrumb')).toContainText('Relay / Compose');
});

test('protects Web administration while keeping Problems actions and Wiki reading available', async ({
  page,
  relayWeb,
}) => {
  test.setTimeout(180_000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerPassword = `relay-owner-${crypto.randomUUID()}`;
  const problemId = `RELAY-WEB-${suffix}`;
  const problemTitle = `Browser payment workflow ${suffix}`;
  const ticketNumber = `INC${Date.now()}`;
  const documentTitle = `Relay Web Publishing ${suffix}`;
  const documentFile = `${documentTitle}.pdf`;
  const pb = await makeSuperuserPbClient(relayWeb);
  await activateOwnerAccount(pb, ownerPassword);
  await pb.collection('dynatrace_problems').create(
    {
      problemId,
      displayId: `P-WEB-${suffix}`,
      title: problemTitle,
      status: 'OPEN',
      severity: 'AVAILABILITY',
      impactLevel: 'APPLICATION',
      startTime: Date.now() - 5 * 60_000,
      endTime: -1,
      rootCauseName: 'relay-web-checkout',
      affectedEntities: [{ id: `SERVICE-${suffix}`, type: 'SERVICE', name: 'relay-web-checkout' }],
      impactedEntities: [],
      managementZones: [{ id: `ZONE-${suffix}`, name: 'Relay Web E2E' }],
      alertingProfiles: ['Relay Web E2E'],
      environmentUrl: 'https://relay-web-e2e.apps.dynatrace.com',
      syncedAt: new Date().toISOString(),
      scopeExcluded: false,
    },
    { requestKey: null },
  );
  try {
    const sync = await pb
      .collection('dynatrace_problem_sync')
      .getFirstListItem<{ id: string }>('key = "primary"', { requestKey: null });
    await pb
      .collection('dynatrace_problem_sync')
      .update(
        sync.id,
        { state: 'ok', error: '', lastSuccessAt: new Date().toISOString() },
        { requestKey: null },
      );
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    await pb.collection('dynatrace_problem_sync').create(
      {
        key: 'primary',
        state: 'ok',
        error: '',
        lastSuccessAt: new Date().toISOString(),
      },
      { requestKey: null },
    );
  }

  await signInRelayWeb(page, relayWeb);
  await page.getByRole('button', { name: 'Problems', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload Relay data only' })).toBeVisible();
  const problem = page.getByRole('button', { name: new RegExp(problemTitle) });
  await expect(problem).toBeVisible();
  await problem.click();
  await page.getByLabel('Service Desk ticket number').fill(ticketNumber);
  await page.getByRole('combobox', { name: 'Resolved by' }).selectOption('Ryan');
  await page.getByRole('button', { name: 'Mark addressed locally' }).click();
  await expect
    .poll(async () => {
      const [states, notes] = await Promise.all([
        pb.collection('dynatrace_problem_states').getFullList<{
          problemId: string;
          addressed: boolean;
          addressedBy?: string;
        }>({ filter: `problemId = "${problemId}"`, requestKey: null }),
        pb.collection('dynatrace_problem_notes').getFullList<{
          problemId: string;
          note: string;
          author?: string;
        }>({ filter: `problemId = "${problemId}"`, requestKey: null }),
      ]);
      return {
        addressed: states[0]?.addressed,
        addressedBy: states[0]?.addressedBy,
        note: notes[0]?.note,
        author: notes[0]?.author,
      };
    })
    .toEqual({
      addressed: true,
      addressedBy: 'Ryan',
      note: `Ticket: ${ticketNumber}`,
      author: 'Ryan',
    });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Access', exact: true }).click();
  const access = page.getByRole('region', { name: 'Privileged access' });
  await access.getByLabel('Username').fill('ryan');
  await access.getByLabel('Password').fill(ownerPassword);
  await access.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(access.getByText('Owner', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Problems', exact: true }).click();
  const protectedSync = page.getByRole('button', { name: 'Sync now from Dynatrace' });
  await expect(protectedSync).toBeVisible();
  const syncResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/relay-api/v1/operations/dynatrace-problems/sync') &&
      response.request().method() === 'POST',
  );
  await protectedSync.click();
  expect((await syncResponsePromise).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Reload Relay data only' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Administration', exact: true }).click();
  const administration = page.getByRole('region', { name: 'Relay administration' });
  await administration.getByRole('link', { name: 'Relay server' }).click();
  await expect(administration.getByRole('button', { name: 'Replace URL' })).toBeDisabled();
  await administration
    .getByLabel('Replacement URL')
    .fill('https://relay-web-e2e.apps.dynatrace.com');
  await administration.getByLabel('Replacement platform token').fill(`dt0s16.relay-web-${suffix}`);
  await page.screenshot({
    path: test.info().outputPath('dynatrace-first-setup.png'),
    animations: 'disabled',
  });
  await administration.getByRole('button', { name: 'Review token replacement' }).click();
  const reauthentication = page.getByRole('dialog', {
    name: 'Confirm platform token replacement',
  });
  await reauthentication.getByLabel('Administrator password').fill(ownerPassword);
  await reauthentication.getByRole('button', { name: 'Replace token' }).click();
  await expect(page.getByText('Dynatrace platform token replaced.', { exact: true })).toBeVisible();
  await expect(
    administration.getByText('https://relay-web-e2e.apps.dynatrace.com', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  const knowledgeHome = page.getByRole('region', { name: 'Knowledge home' });
  await expect(knowledgeHome).toBeVisible();
  await knowledgeHome.getByRole('button', { name: /^Open Wiki,/ }).click();
  await page.getByRole('button', { name: 'Manage Wiki', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manage Wiki', exact: true })).toBeVisible();
  let interruptedFirstChunk = false;
  await page.route('**/relay-api/v1/knowledge/upload/chunk?**', async (route) => {
    if (!interruptedFirstChunk) {
      interruptedFirstChunk = true;
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });
  const pdfFixture = Buffer.from(buildKnowledgePdfFixture({ title: documentTitle, pageCount: 1 }));
  const pdfChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs', exact: true }).click();
  const pdfChooser = await pdfChooserPromise;
  await pdfChooser.setFiles({
    name: documentFile,
    mimeType: 'application/pdf',
    buffer: pdfFixture,
  });
  await expect.poll(() => interruptedFirstChunk).toBe(true);

  await page.reload();
  await expect(page.getByTestId('sidebar-compose')).toBeVisible();
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  const recoveredKnowledgeHome = page.getByRole('region', { name: 'Knowledge home' });
  if (await recoveredKnowledgeHome.isVisible()) {
    await recoveredKnowledgeHome.getByRole('button', { name: /^Open Wiki,/ }).click();
  }
  await page.getByRole('button', { name: 'Manage Wiki', exact: true }).click();
  const interruptedTransfer = page.getByRole('region', { name: 'Interrupted PDF transfer' });
  await expect(interruptedTransfer).toBeVisible();
  await expect(interruptedTransfer).toContainText(documentFile);
  const recoveryChooserPromise = page.waitForEvent('filechooser');
  await interruptedTransfer.getByRole('button', { name: 'Reselect PDFs' }).click();
  const recoveryChooser = await recoveryChooserPromise;
  await recoveryChooser.setFiles({
    name: documentFile,
    mimeType: 'application/pdf',
    buffer: pdfFixture,
  });
  await expect(interruptedTransfer).not.toBeVisible();

  const upload = page.locator('.knowledge-management-row--upload', { hasText: documentFile });
  const publish = upload.getByRole('button', { name: 'Publish', exact: true });
  await expect(publish).toBeEnabled({ timeout: 30_000 });
  await publish.click();
  await expect(upload).not.toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await pb.collection('knowledge_documents').getFullList({
            filter: `fileName = "${documentFile}"`,
            requestKey: null,
          })
        ).length,
      { timeout: 30_000 },
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Return to library' }).click();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Administration', exact: true }).click();
  await administration.getByRole('link', { name: 'Relay server' }).click();
  // A later replacement must reuse the saved URL, not an unsaved URL draft.
  await administration.getByLabel('Replacement URL').fill('https://unsaved.apps.dynatrace.com');
  await administration
    .getByLabel('Replacement platform token')
    .fill(`dt0s16.rotated-web-${suffix}`);
  await administration.getByRole('button', { name: 'Review token replacement' }).click();
  await reauthentication.getByLabel('Administrator password').fill(ownerPassword);
  await reauthentication.getByRole('button', { name: 'Replace token' }).click();
  await expect(page.getByText('Dynatrace platform token replaced.', { exact: true })).toBeVisible();
  await expect(
    administration.getByText('https://relay-web-e2e.apps.dynatrace.com', { exact: true }),
  ).toBeVisible();
  await expect(administration.getByLabel('Replacement platform token')).toHaveValue('');
  await page.getByRole('tab', { name: 'Access', exact: true }).click();
  await access.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(access.getByLabel('Username')).toBeVisible();

  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  const returnedHome = page.getByRole('region', { name: 'Knowledge home' });
  if (await returnedHome.isVisible()) {
    await returnedHome.getByRole('button', { name: /^Open Wiki,/ }).click();
  }
  await expect(page.getByRole('button', { name: 'Manage Wiki', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Open ${documentTitle}`, exact: true }).click();
  const viewer = page.getByRole('region', { name: `${documentTitle} PDF viewer` });
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('Page 1 of 1');
});
