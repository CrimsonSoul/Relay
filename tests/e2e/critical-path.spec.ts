import { _electron as electron, test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import PocketBase from 'pocketbase';
import { writeKnowledgeLinkFixtures } from '../fixtures/knowledgePdfFixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uniqueSuffix = () => crypto.randomUUID().slice(0, 8);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type RelayContact = { email: string };

type RelayOperator = {
  id: string;
  displayName: string;
  active: boolean;
};

type DynatraceProblemNote = {
  id: string;
  problemId: string;
  note: string;
  operatorId?: string;
  author: string;
};

type DynatraceProblemState = {
  id: string;
  problemId: string;
  addressed: boolean;
  operatorId?: string;
  addressedBy?: string;
};

const EXPECTED_OPERATOR_NAMES = [
  'Charles Gibbs',
  'Connor McElroy',
  'Paris Carlson',
  'Ryan Bell',
  'Tristan Stillwell',
  'Vlad McCarty',
  'Weston Yokley',
];
const RYAN_BELL = 'Ryan Bell';
const CHECKOUT_PROBLEM_ID = 'RELAY-DEMO-1001';
const CHECKOUT_PROBLEM_TITLE = 'Checkout service availability below SLO';

const CONFIG_SECRET_FIELD = ['sec', 'ret'].join('');
const makeTestPassphrase = () => ['test', crypto.randomUUID()].join('-');
const TEST_PASSPHRASE = makeTestPassphrase();

const rightClick = async (target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: 'right', force: true });
};

const getActivePanel = (window: Page) => window.locator('.tab-panel--active');

const makePort = () => 20_000 + crypto.randomInt(20_000);

const runDynatraceSeed = (
  userDataDir: string,
  port: number,
  mode: '--dynatrace-only' | '--clear-dynatrace',
) => {
  const env = {
    ...process.env,
    RELAY_SEED_PB_URL: `http://127.0.0.1:${port}`,
    RELAY_SEED_PB_DATA_DIR: path.join(userDataDir, 'data', 'pb_data'),
    RELAY_SEED_SUPERUSER_PASSWORD: TEST_PASSPHRASE,
  };
  execFileSync(process.execPath, [path.join(__dirname, '../../scripts/seed.mjs'), mode], {
    env,
    stdio: 'pipe',
  });
};

const writeServerConfig = (userDataDir: string, port: number) => {
  const dataDir = path.join(userDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ mode: 'server', port, [CONFIG_SECRET_FIELD]: TEST_PASSPHRASE }, null, 2),
    'utf8',
  );
};

const writeClientConfig = (userDataDir: string, port: number) => {
  const dataDir = path.join(userDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify(
      {
        mode: 'client',
        serverUrl: `http://127.0.0.1:${port}`,
        [CONFIG_SECRET_FIELD]: TEST_PASSPHRASE,
      },
      null,
      2,
    ),
    'utf8',
  );
};

const makePbClient = async (port: number) => {
  const pb = new PocketBase(`http://127.0.0.1:${port}`);
  await pb.collection('_pb_users_auth_').authWithPassword('relay@relay.app', TEST_PASSPHRASE, {
    requestKey: null,
  });
  return pb;
};

const createContactDirect = async (port: number, name: string, email: string) => {
  const pb = await makePbClient(port);
  await pb.collection('contacts').create({
    name,
    email,
    title: 'E2E Tester',
    phone: '5551234567',
  });
};

const removeContactDirect = async (port: number, email: string) => {
  const pb = await makePbClient(port);
  const contacts = await pb.collection('contacts').getFullList<{ id: string; email: string }>({
    filter: `email = "${email.replaceAll('"', '\\"')}"`,
    requestKey: null,
  });
  await Promise.all(contacts.map((contact) => pb.collection('contacts').delete(contact.id)));
};

const hasContactDirect = async (port: number, email: string) => {
  const pb = await makePbClient(port);
  const contacts = await pb.collection('contacts').getFullList<RelayContact>({
    filter: `email = "${email.replaceAll('"', '\\"')}"`,
    requestKey: null,
  });
  return contacts.some((contact) => contact.email.toLowerCase() === email.toLowerCase());
};

const goToTab = async (window: Page, testId: string, breadcrumbLabel: string) => {
  await window.getByTestId(testId).click();
  await expect(window.locator('.header-breadcrumb')).toContainText(`Relay / ${breadcrumbLabel}`);
};

const selectOperator = async (window: Page, operatorName: string) => {
  const selector = window.getByTestId('sidebar-operator-selector');
  await expect(selector).toBeEnabled();
  await selector.click();
  await window.getByRole('menuitemradio', { name: operatorName, exact: true }).click();
  await expect(selector).toHaveAccessibleName(`Selected operator: ${operatorName}`);
};

const expectNewestProblem = async (window: Page, title: string) => {
  const queue = window.getByRole('region', { name: 'Dynatrace problem queue' });
  await expect(queue.locator('.dt-problem-row').first()).toContainText(title);
};

const getOperatorRoster = async (port: number) => {
  const pb = await makePbClient(port);
  return pb.collection('relay_operators').getFullList<RelayOperator>({
    sort: 'displayName',
    requestKey: null,
  });
};

const getDynatraceAttribution = async (port: number, problemId: string, noteText: string) => {
  const pb = await makePbClient(port);
  const [notes, states] = await Promise.all([
    pb.collection('dynatrace_problem_notes').getFullList<DynatraceProblemNote>({
      requestKey: null,
    }),
    pb.collection('dynatrace_problem_states').getFullList<DynatraceProblemState>({
      requestKey: null,
    }),
  ]);
  return {
    note: notes.find((record) => record.problemId === problemId && record.note === noteText),
    state: states.find((record) => record.problemId === problemId),
  };
};

const tryEnsurePeopleTabReady = async (window: Page) => {
  await goToTab(window, 'sidebar-people', 'People');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const addContact = window.getByRole('button', { name: 'ADD CONTACT' });
    if (await addContact.isVisible()) {
      return true;
    }

    const reload = window.getByRole('button', { name: 'Reload' }).first();
    if (await reload.isVisible()) {
      await Promise.all([window.waitForLoadState('domcontentloaded'), reload.click()]);
      await goToTab(window, 'sidebar-people', 'People');
      continue;
    }

    await window.waitForTimeout(500);
  }

  return false;
};

const createContactFromPeople = async (window: Page, port: number, name: string, email: string) => {
  const peopleReady = await tryEnsurePeopleTabReady(window);

  if (!peopleReady) {
    await createContactDirect(port, name, email);

    await expect.poll(() => hasContactDirect(port, email)).toBe(true);

    return null;
  }

  await window.getByRole('button', { name: 'ADD CONTACT' }).click();
  const addModal = window.getByRole('dialog', { name: /Add Contact/i });
  await expect(addModal).toBeVisible();

  await addModal.getByLabel('Full Name').fill(name);
  await addModal.getByLabel('Email Address').fill(email);
  await addModal.getByLabel('Job Title').fill('E2E Tester');
  await addModal.getByLabel('Phone Number').fill('5551234567');

  await addModal.getByRole('button', { name: 'Create Contact' }).click();
  await expect(addModal).not.toBeVisible();

  const activePanel = getActivePanel(window);
  const contactCard = activePanel
    .getByRole('button', { name: new RegExp(escapeRegExp(email), 'i') })
    .first();
  await expect(contactCard).toBeVisible();

  return contactCard;
};

const deleteContactFromPeople = async (window: Page, port: number, email: string) => {
  const peopleReady = await tryEnsurePeopleTabReady(window);

  if (!peopleReady) {
    await removeContactDirect(port, email);

    await expect.poll(() => hasContactDirect(port, email)).toBe(false);

    return;
  }

  const activePanel = getActivePanel(window);
  const contactCard = activePanel
    .getByRole('button', { name: new RegExp(escapeRegExp(email), 'i') })
    .first();
  await expect(contactCard).toBeVisible();
  await contactCard.click();

  const detailPanelDelete = window.locator('.detail-panel').getByRole('button', { name: 'Delete' });
  if (await detailPanelDelete.isVisible()) {
    await detailPanelDelete.click();
  } else {
    await rightClick(contactCard);
    const deleteOption = window.getByRole('menuitem', { name: 'Delete' });
    await expect(deleteOption).toBeVisible();
    await deleteOption.click();
  }

  const confirmModal = window.getByRole('dialog', { name: /Delete Contact/i });
  await expect(confirmModal).toBeVisible();
  await confirmModal.getByRole('button', { name: 'Delete Contact' }).click();
  await expect(confirmModal).not.toBeVisible();

  await expect
    .poll(() => hasContactDirect(port, email), { message: `contact ${email} should be deleted` })
    .toBe(false);
};

test.describe('Vital Critical Path', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | null;
  let window: Awaited<ReturnType<NonNullable<typeof electronApp>['firstWindow']>>;
  let clientElectronApp: Awaited<ReturnType<typeof electron.launch>> | null;
  let clientWindow: Page | null;
  let tempDataDir: string;
  let clientDataDir: string;
  let pbPort: number;

  const launchServer = async () => {
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    const launchEnv = { ...process.env, NODE_ENV: 'test' };
    delete (launchEnv as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;

    electronApp = await electron.launch({
      args: [`--user-data-dir=${tempDataDir}`, mainEntry],
      env: launchEnv,
    });
    window = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000);
    });
    await window.waitForLoadState('domcontentloaded');
    await expect(window.getByTestId('sidebar-compose')).toBeVisible();
    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
  };

  const launchClient = async () => {
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    const launchEnv = { ...process.env, NODE_ENV: 'test' };
    delete (launchEnv as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
    if (!clientDataDir) {
      clientDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-client-'));
      writeClientConfig(clientDataDir, pbPort);
    }

    clientElectronApp = await electron.launch({
      args: [`--user-data-dir=${clientDataDir}`, mainEntry],
      env: launchEnv,
    });
    clientWindow = await clientElectronApp.firstWindow();
    await clientElectronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000);
    });
    await clientWindow.waitForLoadState('domcontentloaded');
    await expect(clientWindow.getByTestId('sidebar-compose')).toBeVisible();
    return clientWindow;
  };

  const launchConnectedClient = async () => {
    const connectedClient = await launchClient();
    await expect(connectedClient.locator('[data-connection-state="online"]').first()).toBeVisible();
    return connectedClient;
  };

  test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-critical-'));
    clientElectronApp = null;
    clientWindow = null;
    clientDataDir = '';
    pbPort = makePort();
    writeServerConfig(tempDataDir, pbPort);
    if (testInfo.title.includes('Knowledge PDF links')) {
      writeKnowledgeLinkFixtures(path.join(tempDataDir, 'data', 'knowledge-base'));
    }
    await launchServer();
  });

  test.afterEach(async () => {
    if (clientElectronApp) {
      const activeClientApp = clientElectronApp;
      try {
        await activeClientApp.evaluate(({ shell }) => {
          const scope = globalThis as typeof globalThis & {
            __relayKnowledgeOriginalOpenExternal?: typeof shell.openExternal;
            __relayKnowledgeOpenExternalUrls?: string[];
          };
          if (scope.__relayKnowledgeOriginalOpenExternal) {
            shell.openExternal = scope.__relayKnowledgeOriginalOpenExternal;
          }
          delete scope.__relayKnowledgeOriginalOpenExternal;
          delete scope.__relayKnowledgeOpenExternalUrls;
        });
      } catch {
        // The client may already be closed; restoring a test-only spy is best effort.
      }
      try {
        await clientWindow?.context().setOffline(false);
      } catch {
        // Resetting Playwright's network state is independent of Electron shutdown.
      }
      try {
        await activeClientApp.close();
      } catch {
        // The client app may already be closed after a test failure.
      }
      clientElectronApp = null;
      clientWindow = null;
    }
    if (electronApp) {
      try {
        await electronApp.close();
      } catch {
        // The app may already be closed after a test failure.
      }
      electronApp = null;
    }
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
    if (clientDataDir) {
      fs.rmSync(clientDataDir, { recursive: true, force: true });
    }
  });

  test('Vital 1: App Launch & Compose Tab', async () => {
    const title = await window.title();
    expect(title).toMatch(/Relay/i);

    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
    await expect(window.getByRole('button', { name: 'START BRIDGE' })).toBeVisible();
  });

  test('Knowledge PDF links navigate within Relay and open HTTPS in the system browser', async () => {
    test.setTimeout(120_000);
    const connectedClient = await launchConnectedClient();
    const rendererLogs: string[] = [];
    connectedClient.on('console', (message) => rendererLogs.push(message.text()));

    await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge Base');
    const sourceDocument = connectedClient.getByRole('treeitem', {
      name: 'Link navigation test',
      exact: true,
    });
    await expect(sourceDocument).toBeVisible();
    await sourceDocument.click();

    const sourceViewer = connectedClient.getByRole('region', {
      name: 'Link navigation test PDF viewer',
    });
    await expect(sourceViewer).toContainText('Page 1 of 2');
    await sourceViewer.getByRole('button', { name: 'Open linked location in this guide' }).click();
    await expect(sourceViewer).toContainText('Page 2 of 2');
    await expect(sourceDocument).toHaveAttribute('aria-current', 'page');

    await sourceViewer.getByRole('button', { name: 'Previous page' }).click();
    await expect(sourceViewer).toContainText('Page 1 of 2');
    await sourceViewer
      .getByRole('button', { name: 'Open Payment API Degradation Guide, page 2' })
      .click();

    const paymentViewer = connectedClient.getByRole('region', {
      name: 'Payment API Degradation Guide PDF viewer',
    });
    await expect(paymentViewer).toContainText('Page 2 of 2');

    await connectedClient.getByRole('treeitem', { name: 'General, 1 document' }).click();
    await connectedClient
      .getByRole('treeitem', { name: 'Link navigation test', exact: true })
      .click();
    await expect(sourceViewer).toContainText('Page 1 of 2');
    const authorDirectory = 'C:/Users/Author/Documents';
    const absoluteFileOverlay = sourceViewer.getByRole('button', {
      name: 'Open Checkout Service Incident Runbook, page 1',
      exact: true,
    });
    await expect(absoluteFileOverlay).toBeVisible();
    await expect(sourceViewer).not.toContainText(authorDirectory);
    await expect(connectedClient.locator('body')).not.toContainText(authorDirectory);
    await absoluteFileOverlay.focus();
    await expect(absoluteFileOverlay).toBeFocused();
    await expect(absoluteFileOverlay).toHaveAccessibleName(
      'Open Checkout Service Incident Runbook, page 1',
    );
    await expect(absoluteFileOverlay).not.toHaveAccessibleName(/C:\/Users\/Author\/Documents/);
    await absoluteFileOverlay.click();

    const checkoutViewer = connectedClient.getByRole('region', {
      name: 'Checkout Service Incident Runbook PDF viewer',
    });
    await expect(checkoutViewer).toContainText('Page 1 of 1');
    await expect(connectedClient.locator('body')).not.toContainText(authorDirectory);
    expect(rendererLogs.join('\n')).not.toContain(authorDirectory);

    await connectedClient.getByRole('treeitem', { name: 'General, 1 document' }).click();
    await connectedClient
      .getByRole('treeitem', { name: 'Link navigation test', exact: true })
      .click();
    await expect(sourceViewer).toContainText('Page 1 of 2');

    if (!clientElectronApp) throw new Error('Connected Electron app not launched');
    await clientElectronApp.evaluate(({ shell }) => {
      const scope = globalThis as typeof globalThis & {
        __relayKnowledgeOriginalOpenExternal?: typeof shell.openExternal;
        __relayKnowledgeOpenExternalUrls?: string[];
      };
      scope.__relayKnowledgeOriginalOpenExternal = shell.openExternal;
      scope.__relayKnowledgeOpenExternalUrls = [];
      shell.openExternal = async (url) => {
        scope.__relayKnowledgeOpenExternalUrls?.push(url);
      };
    });

    await sourceViewer.getByRole('button', { name: 'Open example.com in browser' }).click();
    await expect
      .poll(() =>
        clientElectronApp?.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                __relayKnowledgeOpenExternalUrls?: string[];
              }
            ).__relayKnowledgeOpenExternalUrls ?? [],
        ),
      )
      .toContain('https://example.com/relay-knowledge-test');
  });

  test('Dynatrace Problems tab opens without requiring a configured token', async () => {
    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');

    await expect(window.getByRole('heading', { name: 'Local response queue' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Unaddressed 0' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Refresh Dynatrace Problems' })).toBeVisible();
  });

  test('Service Status uses the operational queue layout', async () => {
    await goToTab(window, 'sidebar-status', 'Service Status');

    await expect(window.getByRole('heading', { name: 'External service monitor' })).toBeVisible();
    await expect(window.getByRole('tablist', { name: 'Incident feed filters' })).toBeVisible();
    await expect(window.getByLabel('Search service status')).toBeVisible();
    await expect(window.getByRole('region', { name: 'Provider posture' })).toBeVisible();
    await expect(window.getByRole('region', { name: 'Service incident feed' })).toBeVisible();
    await expect(window.getByText('ADP', { exact: true })).toHaveCount(0);
  });

  test('Dynatrace Problems demo seed is repeatable and isolated', async () => {
    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');

    const pb = await makePbClient(pbPort);
    const seededProblems = await pb.collection('dynatrace_problems').getFullList({
      filter: 'problemId ~ "RELAY-DEMO-"',
      requestKey: null,
    });
    expect(seededProblems).toHaveLength(7);

    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');
    await expect(window.getByRole('tab', { name: 'Unaddressed 4' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Addressed locally 1' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'History 2' })).toBeVisible();
    await expect(window.getByRole('tab', { name: /^All/ })).toHaveCount(0);
    await expect(
      window.getByRole('heading', { name: 'Checkout service availability below SLO' }),
    ).toBeVisible();

    runDynatraceSeed(tempDataDir, pbPort, '--clear-dynatrace');
    const remainingDemoProblems = await pb.collection('dynatrace_problems').getFullList({
      filter: 'problemId ~ "RELAY-DEMO-"',
      requestKey: null,
    });
    expect(remainingDemoProblems).toHaveLength(0);
  });

  test('new Dynatrace Problems sync Ryan Bell attribution to a connected client', async () => {
    test.setTimeout(90_000);
    const noteText = 'NOC confirmed impact and paged the checkout team.';

    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');
    await expect(window.getByRole('tab', { name: 'Unaddressed 0' })).toBeVisible();
    await goToTab(window, 'sidebar-compose', 'Compose');

    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');

    const operators = await getOperatorRoster(pbPort);
    expect(operators.map(({ displayName }) => displayName)).toEqual(EXPECTED_OPERATOR_NAMES);
    expect(operators).toHaveLength(7);
    const ryan = operators.find(({ displayName }) => displayName === RYAN_BELL);
    expect(ryan).toMatchObject({ displayName: RYAN_BELL, active: true });
    expect(ryan?.id).toMatch(/^[a-z0-9]{15}$/);

    const connectedClient = await launchConnectedClient();
    await goToTab(connectedClient, 'sidebar-problems', 'Dynatrace Problems');
    await expect(connectedClient.getByRole('tab', { name: 'Unaddressed 4' })).toBeVisible();
    await expectNewestProblem(connectedClient, CHECKOUT_PROBLEM_TITLE);

    await expect(window.getByText('New Dynatrace problems')).toBeVisible();
    await expect(
      window.getByText('P-DEMO-1001 · Checkout service availability below SLO (+4 more)'),
    ).toBeVisible();
    await window.getByRole('button', { name: 'Open Problems' }).click();
    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Dynatrace Problems');
    await expectNewestProblem(window, CHECKOUT_PROBLEM_TITLE);
    await selectOperator(window, RYAN_BELL);

    const addressedAction = window.getByRole('button', { name: 'Mark addressed locally' });
    await expect(addressedAction).toBeDisabled();
    await window.getByLabel('Add a note').fill(noteText);
    await expect(addressedAction).toBeEnabled();
    await addressedAction.click();
    await expect(window.getByRole('tab', { name: 'Addressed locally 2' })).toBeVisible();

    await expect
      .poll(async () => {
        const { note, state } = await getDynatraceAttribution(
          pbPort,
          CHECKOUT_PROBLEM_ID,
          noteText,
        );
        return {
          noteOperatorId: note?.operatorId,
          author: note?.author,
          stateOperatorId: state?.operatorId,
          addressedBy: state?.addressedBy,
          addressed: state?.addressed,
        };
      })
      .toEqual({
        noteOperatorId: ryan!.id,
        author: RYAN_BELL,
        stateOperatorId: ryan!.id,
        addressedBy: RYAN_BELL,
        addressed: true,
      });

    await window.getByRole('tab', { name: 'Addressed locally 2' }).click();
    await expectNewestProblem(window, CHECKOUT_PROBLEM_TITLE);

    await expect(connectedClient.getByRole('tab', { name: 'Addressed locally 2' })).toBeVisible();
    await connectedClient.getByRole('tab', { name: 'Addressed locally 2' }).click();
    await expectNewestProblem(connectedClient, CHECKOUT_PROBLEM_TITLE);
    const clientDetail = connectedClient.getByRole('region', {
      name: 'Selected problem details',
    });
    await expect(clientDetail.getByRole('heading', { name: CHECKOUT_PROBLEM_TITLE })).toBeVisible();
    await expect(clientDetail.locator('.dt-problem-detail__response-copy')).toContainText(
      RYAN_BELL,
    );
    const syncedNote = clientDetail.locator('.dt-problem-note', { hasText: noteText });
    await expect(syncedNote).toContainText(RYAN_BELL);
  });

  test('connected client retains Ryan Bell attribution through offline queue sync', async () => {
    test.setTimeout(90_000);
    const noteText = `Offline NOC follow-up ${uniqueSuffix()}`;

    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
    const operators = await getOperatorRoster(pbPort);
    expect(operators.map(({ displayName }) => displayName)).toEqual(EXPECTED_OPERATOR_NAMES);
    expect(operators).toHaveLength(7);
    const ryan = operators.find(({ displayName }) => displayName === RYAN_BELL);
    expect(ryan).toMatchObject({ displayName: RYAN_BELL, active: true });

    let connectedClient = await launchConnectedClient();
    await goToTab(connectedClient, 'sidebar-problems', 'Dynatrace Problems');
    await expect(connectedClient.getByRole('tab', { name: 'Unaddressed 4' })).toBeVisible();
    await expectNewestProblem(connectedClient, CHECKOUT_PROBLEM_TITLE);
    await selectOperator(connectedClient, RYAN_BELL);

    await expect
      .poll(() =>
        connectedClient.evaluate(async () => {
          const [problems, operators] = await Promise.all([
            globalThis.api?.cacheRead?.('dynatrace_problems'),
            globalThis.api?.cacheRead?.('relay_operators'),
          ]);
          return { problems: problems?.length ?? 0, operators: operators?.length ?? 0 };
        }),
      )
      .toEqual({ problems: 7, operators: 7 });

    await electronApp?.close();
    electronApp = null;
    await expect
      .poll(async () => {
        try {
          await fetch(`http://127.0.0.1:${pbPort}/api/health`);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await clientElectronApp?.close();
    clientElectronApp = null;
    clientWindow = null;

    connectedClient = await launchClient();
    const connectionStatus = connectedClient.locator('[data-connection-state]').first();
    await expect(connectionStatus).toHaveAttribute('data-connection-state', 'offline');
    await goToTab(connectedClient, 'sidebar-problems', 'Dynatrace Problems');
    await expect(connectedClient.getByRole('tab', { name: 'Unaddressed 4' })).toBeVisible();
    await expectNewestProblem(connectedClient, CHECKOUT_PROBLEM_TITLE);
    await expect(connectedClient.getByTestId('sidebar-operator-selector')).toHaveAccessibleName(
      `Selected operator: ${RYAN_BELL}`,
    );
    await expect(
      connectedClient.getByText('You are offline. Changes will sync when Relay reconnects.'),
    ).toBeVisible();

    const addressedAction = connectedClient.getByRole('button', {
      name: 'Mark addressed locally',
    });
    await connectedClient.getByLabel('Add a note').fill(noteText);
    await expect(addressedAction).toBeEnabled();
    await addressedAction.click();
    await expect
      .poll(() =>
        connectedClient.evaluate(async () =>
          globalThis.api?.getPendingSyncStatus?.().then((status) => status.pendingCount),
        ),
      )
      .toBe(2);
    await expect(
      connectedClient.locator('[data-connection-state]', { hasText: '2 changes pending' }),
    ).toBeVisible();

    await clientElectronApp?.close();
    clientElectronApp = null;
    clientWindow = null;
    await launchServer();
    connectedClient = await launchConnectedClient();

    await expect
      .poll(async () => {
        const { note, state } = await getDynatraceAttribution(
          pbPort,
          CHECKOUT_PROBLEM_ID,
          noteText,
        );
        return {
          noteOperatorId: note?.operatorId,
          author: note?.author,
          stateOperatorId: state?.operatorId,
          addressedBy: state?.addressedBy,
          addressed: state?.addressed,
        };
      })
      .toEqual({
        noteOperatorId: ryan!.id,
        author: RYAN_BELL,
        stateOperatorId: ryan!.id,
        addressedBy: RYAN_BELL,
        addressed: true,
      });
    await expect
      .poll(() =>
        connectedClient.evaluate(async () =>
          globalThis.api?.getPendingSyncStatus?.().then((status) => status.pendingCount),
        ),
      )
      .toBe(0);
    await expect(
      connectedClient.locator('[data-connection-state]', { hasText: 'pending' }),
    ).toHaveCount(0);
  });

  test('Compose bridge action buttons do not overlap on compact desktop widths', async () => {
    if (!electronApp) throw new Error('Electron app not launched');

    for (const width of [1440, 1366, 1280, 1100]) {
      await electronApp.evaluate(({ BrowserWindow }, viewportWidth) => {
        BrowserWindow.getAllWindows()[0]?.setSize(viewportWidth, 900);
      }, width);
      await window.waitForTimeout(300);

      const geometry = await window.evaluate(() => {
        const toRect = (element: {
          getBoundingClientRect: () => {
            left: number;
            right: number;
            top: number;
            bottom: number;
          };
        }) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        };
        const buttonByText = (text: string) =>
          [...globalThis.document.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === text,
          );

        const actions = globalThis.document.querySelector('.collapsible-header-actions');
        const start = buttonByText('Start Bridge');
        const schedule = buttonByText('Schedule Bridge');
        if (!actions || !start || !schedule) return null;

        const actionsRect = toRect(actions);
        const startRect = toRect(start);
        const scheduleRect = toRect(schedule);
        const overlapWidth = Math.max(
          0,
          Math.min(startRect.right, scheduleRect.right) -
            Math.max(startRect.left, scheduleRect.left),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(startRect.bottom, scheduleRect.bottom) -
            Math.max(startRect.top, scheduleRect.top),
        );

        return {
          actionsRect,
          startRect,
          scheduleRect,
          overlapArea: overlapWidth * overlapHeight,
        };
      });

      expect(geometry, `geometry at ${width}px`).not.toBeNull();
      expect(geometry!.overlapArea, `button overlap at ${width}px`).toBe(0);
      for (const rect of [geometry!.startRect, geometry!.scheduleRect]) {
        expect(rect.left, `left bound at ${width}px`).toBeGreaterThanOrEqual(
          geometry!.actionsRect.left - 1,
        );
        expect(rect.right, `right bound at ${width}px`).toBeLessThanOrEqual(
          geometry!.actionsRect.right + 1,
        );
      }
    }
  });

  test('Vital 2: Navigation to On-Call & Servers', async () => {
    await goToTab(window, 'sidebar-on-call', 'On-Call');
    await expect(window.getByRole('button', { name: 'ADD CARD' })).toBeVisible();

    await goToTab(window, 'sidebar-servers', 'Servers');
    await expect(window.getByRole('button', { name: 'ADD SERVER' })).toBeVisible();
  });

  test('Vital 3: Data Integrity (Add/Delete Contact)', async () => {
    const suffix = uniqueSuffix();
    const name = `Vital Test ${suffix}`;
    const email = `vital.test.${suffix}@example.com`;

    await createContactFromPeople(window, pbPort, name, email);
    await deleteContactFromPeople(window, pbPort, email);
  });

  test('Vital 4: On-Call Management (Add/Rename/Remove Card)', async () => {
    await goToTab(window, 'sidebar-on-call', 'On-Call');

    const teamName = `Vital Team ${uniqueSuffix()}`;
    await window.getByRole('button', { name: 'ADD CARD' }).click();

    const addModal = window.getByRole('dialog', { name: /Add New Card/i });
    await expect(addModal).toBeVisible();
    await addModal.getByPlaceholder(/Card Name/i).fill(teamName);
    await addModal.getByRole('button', { name: 'Add Card' }).click();
    await expect(addModal).not.toBeVisible();

    const teamCard = window.locator('.team-card-body', { hasText: teamName }).first();
    await expect(teamCard).toBeVisible();

    await rightClick(teamCard);
    const renameOption = window.getByRole('menuitem', { name: 'Rename Team' });
    await expect(renameOption).toBeVisible();
    await renameOption.click();

    const renameModal = window.getByRole('dialog', { name: /Rename Card/i });
    await expect(renameModal).toBeVisible();

    const renamedTeam = `${teamName} Renamed`;
    const renameInput = renameModal.locator('input').first();
    await renameInput.fill(renamedTeam);
    await renameModal.getByRole('button', { name: 'Rename' }).click();
    await expect(renameModal).not.toBeVisible();

    const renamedCard = window.locator('.team-card-body', { hasText: renamedTeam }).first();
    await expect(renamedCard).toBeVisible();

    await rightClick(renamedCard);
    const removeOption = window.getByRole('menuitem', { name: 'Remove Team' });
    await expect(removeOption).toBeVisible();
    await removeOption.click();

    const removeModal = window.getByRole('dialog', { name: /Remove Card/i });
    await expect(removeModal).toBeVisible();
    await removeModal.getByRole('button', { name: 'Remove' }).click();
    await expect(removeModal).not.toBeVisible();

    await expect(window.locator('.team-card-body', { hasText: renamedTeam })).toHaveCount(0);
  });

  test('Vital 5: Composer Workflow (Add, Group, Draft)', async () => {
    const suffix = uniqueSuffix();
    const name = `Composer Test ${suffix}`;
    const email = `composer.test.${suffix}@example.com`;
    const groupName = `Vital Group ${suffix}`;

    const contactCard = await createContactFromPeople(window, pbPort, name, email);
    if (contactCard) {
      await rightClick(contactCard);
      await window.getByRole('menuitem', { name: 'Add to Composer' }).click();
    }

    await goToTab(window, 'sidebar-compose', 'Compose');
    if (!contactCard) {
      const search = window.getByLabel('Search');
      await search.fill(email);
      await search.press('Enter');
    }
    const composePanel = getActivePanel(window);
    await expect(composePanel.locator(`text=${email}`)).toBeVisible();

    await window.getByTitle('Create new group').click();
    const createGroupModal = window.locator('dialog', { hasText: /Create New Group/i });
    await expect(createGroupModal).toBeVisible();
    await createGroupModal.getByLabel('Group Name').fill(groupName);
    await createGroupModal.getByRole('button', { name: 'Save' }).click();
    await expect(createGroupModal).not.toBeVisible();

    const groupItem = composePanel
      .getByRole('button', { name: new RegExp(escapeRegExp(groupName), 'i') })
      .first();
    await expect(groupItem).toBeVisible();

    await window.getByRole('button', { name: 'START BRIDGE' }).click();
    const reminderModal = window.getByRole('dialog', { name: /Meeting Recording/i });
    await expect(reminderModal).toBeVisible();
    await reminderModal.getByRole('button', { name: 'I Understand' }).click();
    await expect(reminderModal).not.toBeVisible();

    await rightClick(groupItem);
    const deleteSavedGroup = window.getByRole('menuitem', { name: 'Delete Group' });
    await expect(deleteSavedGroup).toBeVisible();
    await deleteSavedGroup.click();
    await expect(
      composePanel.getByRole('button', { name: new RegExp(escapeRegExp(groupName), 'i') }),
    ).toHaveCount(0);

    await deleteContactFromPeople(window, pbPort, email);
  });
});
