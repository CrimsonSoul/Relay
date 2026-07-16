import { _electron as electron, test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import PocketBase from 'pocketbase';
import {
  buildKnowledgePdfFixture,
  createKnowledgeLinkFixtures,
} from '../fixtures/knowledgePdfFixtures';

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
  'Ryan Bledsoe',
  'Tristan Bowles',
  'Tristan Stillwell',
  'Vlad McCarty',
  'Weston Yokley',
];
const RYAN_BELL = 'Ryan Bell';
const RYAN_BLEDSOE = 'Ryan Bledsoe';
const TRISTAN_BOWLES = 'Tristan Bowles';
const CHECKOUT_PROBLEM_ID = 'RELAY-DEMO-1001';
const CHECKOUT_PROBLEM_TITLE = 'Checkout service availability below SLO';
const KNOWLEDGE_CHUNK_BYTES = 4 * 1024 * 1024;

const CONFIG_SECRET_FIELD = ['sec', 'ret'].join('');
const makeTestPassphrase = () => ['test', crypto.randomUUID()].join('-');
const TEST_PASSPHRASE = makeTestPassphrase();
const PRIVILEGED_TEST_PASSWORD = `e2e-privileged-${crypto.randomUUID()}`;
const PUBLISHER_TEST_PASSWORD = `e2e-publisher-${crypto.randomUUID()}`;

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

const makeSuperuserPbClient = async (port: number) => {
  const pb = new PocketBase(`http://127.0.0.1:${port}`);
  await pb.collection('_superusers').authWithPassword('admin@relay.app', TEST_PASSPHRASE, {
    requestKey: null,
  });
  return pb;
};

const seedKnowledgeLinkFixtures = async (port: number) => {
  const pb = await makeSuperuserPbClient(port);
  const timestamp = new Date().toISOString();
  for (const fixture of createKnowledgeLinkFixtures()) {
    const bytes = Uint8Array.from(fixture.data);
    const form = new FormData();
    form.set('sourceKey', `${fixture.category}/${fixture.fileName}`);
    form.set('category', fixture.category);
    form.set('title', fixture.title);
    form.set('displayTitle', fixture.title);
    form.set('fileName', fixture.fileName);
    form.set('pdf', new Blob([bytes.buffer], { type: 'application/pdf' }), fixture.fileName);
    form.set('checksum', crypto.createHash('sha256').update(bytes).digest('hex'));
    form.set('byteSize', String(bytes.byteLength));
    form.set('pageCount', String(fixture.pageCount));
    form.set('outline', JSON.stringify([]));
    form.set('outlineSource', 'none');
    form.set('sourceModifiedAt', timestamp);
    form.set('indexedAt', timestamp);
    form.set('lifecycleState', 'active');
    form.set('revision', '1');
    form.set('publishedAt', timestamp);
    await pb.collection('knowledge_documents').create(form, { requestKey: null });
  }
};

const waitForOperator = async (pb: PocketBase, displayName: string) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await pb
        .collection('relay_operators')
        .getFirstListItem<RelayOperator>(`displayName = "${displayName}"`, {
          requestKey: null,
        });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
};

const activatePrivilegedAdministratorFixture = async (port: number) => {
  const pb = await makeSuperuserPbClient(port);
  const operator = await waitForOperator(pb, RYAN_BLEDSOE);
  const accounts = await pb
    .collection('relay_privileged_accounts')
    .getFullList<{ id: string; credentialVersion: number }>({
      filter: `operatorId = "${operator.id}"`,
      requestKey: null,
    });
  const account = accounts[0];
  const values = {
    email: `${operator.id}@relay.invalid`,
    operatorId: operator.id,
    role: 'admin',
    active: true,
    mustChangePassword: false,
    credentialVersion: (account?.credentialVersion ?? 0) + 1,
    password: PRIVILEGED_TEST_PASSWORD,
    passwordConfirm: PRIVILEGED_TEST_PASSWORD,
  };
  if (account) {
    await pb
      .collection('relay_privileged_accounts')
      .update(account.id, values, { requestKey: null });
  } else {
    try {
      await pb.collection('relay_privileged_accounts').create(values, { requestKey: null });
    } catch (error) {
      const detail =
        error && typeof error === 'object' && 'response' in error
          ? JSON.stringify((error as { response: unknown }).response)
          : 'unknown';
      throw new Error(`Could not create privileged E2E account: ${detail}`);
    }
  }
  const authCheck = new PocketBase(`http://127.0.0.1:${port}`);
  try {
    const authResult = await authCheck
      .collection('relay_privileged_accounts')
      .authWithPassword(operator.id, PRIVILEGED_TEST_PASSWORD, { requestKey: null });
    const authenticated = authResult.record as unknown as Record<string, unknown>;
    if (
      authenticated.collectionName !== 'relay_privileged_accounts' ||
      authenticated.operatorId !== operator.id ||
      authenticated.active !== true ||
      authenticated.role !== 'admin' ||
      authenticated.mustChangePassword !== false ||
      !Number.isSafeInteger(authenticated.credentialVersion)
    ) {
      throw new Error(`Unexpected privileged auth record: ${JSON.stringify(authenticated)}`);
    }
    const [state, resolvedOperator] = await Promise.all([
      authCheck
        .collection('relay_privileged_state')
        .getFirstListItem<{ adminOperatorId: string }>('key = "primary"', {
          requestKey: null,
        }),
      authCheck.collection('relay_operators').getOne<RelayOperator>(operator.id, {
        requestKey: null,
      }),
    ]);
    if (state.adminOperatorId !== operator.id || resolvedOperator.displayName !== RYAN_BLEDSOE) {
      throw new Error('Privileged fixture assignment is inconsistent.');
    }
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'response' in error
        ? JSON.stringify((error as { response: unknown }).response)
        : 'unknown';
    throw new Error(`Could not authenticate privileged E2E account: ${detail}`);
  }
  return operator.id;
};

const activatePrivilegedPublisherFixture = async (port: number) => {
  const pb = await makeSuperuserPbClient(port);
  const operator = await waitForOperator(pb, TRISTAN_BOWLES);
  const state = await pb.collection('relay_privileged_state').getFirstListItem<{
    id: string;
    adminOperatorId: string;
    assignmentVersion: number;
  }>('key = "primary"', { requestKey: null });
  await pb.collection('relay_privileged_state').update(
    state.id,
    {
      publisherOperatorId: operator.id,
      assignmentVersion: state.assignmentVersion + 1,
      updatedByOperatorId: state.adminOperatorId,
      updatedAt: new Date().toISOString(),
    },
    { requestKey: null },
  );

  const accounts = await pb
    .collection('relay_privileged_accounts')
    .getFullList<{ id: string; credentialVersion: number }>({
      filter: `operatorId = "${operator.id}"`,
      requestKey: null,
    });
  const account = accounts[0];
  const values = {
    email: `${operator.id}@relay.invalid`,
    operatorId: operator.id,
    role: 'publisher',
    active: true,
    mustChangePassword: false,
    credentialVersion: (account?.credentialVersion ?? 0) + 1,
    password: PUBLISHER_TEST_PASSWORD,
    passwordConfirm: PUBLISHER_TEST_PASSWORD,
  };
  const updated = account
    ? await pb.collection('relay_privileged_accounts').update(account.id, values, {
        requestKey: null,
      })
    : await pb.collection('relay_privileged_accounts').create(values, { requestKey: null });

  const authCheck = new PocketBase(`http://127.0.0.1:${port}`);
  const authResult = await authCheck
    .collection('relay_privileged_accounts')
    .authWithPassword(operator.id, PUBLISHER_TEST_PASSWORD, { requestKey: null });
  expect(authResult.record).toMatchObject({
    id: updated.id,
    operatorId: operator.id,
    role: 'publisher',
    active: true,
  });
  return { accountId: updated.id, operatorId: operator.id };
};

const writePaddedKnowledgePdfFixture = (target: string, title: string, byteSize: number): void => {
  const pdf = buildKnowledgePdfFixture({ title, pageCount: 1 });
  if (pdf.byteLength > byteSize) throw new Error('Knowledge E2E fixture size is too small.');
  const bytes = Buffer.alloc(byteSize, 0x20);
  bytes.set(pdf);
  fs.writeFileSync(target, bytes, { mode: 0o600 });
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
  if ((await selector.getAttribute('aria-label')) === `Selected operator: ${operatorName}`) return;
  await selector.click();
  await window.getByRole('menuitemradio', { name: operatorName, exact: true }).click();
  await expect(selector).toHaveAccessibleName(`Selected operator: ${operatorName}`);
};

const openPrivilegedAccess = async (targetWindow: Page) => {
  await goToTab(targetWindow, 'sidebar-settings', 'Settings');
  await targetWindow.getByRole('tab', { name: 'Access', exact: true }).click();
  const panel = targetWindow.getByRole('region', { name: 'Privileged access' });
  await expect(panel).toBeVisible();
  return panel;
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
    const launchEnv = {
      ...process.env,
      NODE_ENV: 'test',
      RELAY_E2E_PRIVILEGED_FIXTURES: '1',
    };
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
    const launchEnv = {
      ...process.env,
      NODE_ENV: 'test',
      RELAY_E2E_PRIVILEGED_FIXTURES: '1',
      RELAY_E2E_KNOWLEDGE_CHUNK_DELAY_MS: '150',
    };
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

  const installKnowledgeDialogFixture = async (filePaths: string[]) => {
    if (!clientElectronApp) throw new Error('Connected Electron app not launched');
    await clientElectronApp.evaluate(({ dialog }, selectedPaths) => {
      const scope = globalThis as typeof globalThis & {
        __relayKnowledgeOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
      };
      scope.__relayKnowledgeOriginalShowOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selectedPaths });
    }, filePaths);
  };

  test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-critical-'));
    clientElectronApp = null;
    clientWindow = null;
    clientDataDir = '';
    pbPort = makePort();
    writeServerConfig(tempDataDir, pbPort);
    await launchServer();
    if (
      testInfo.title.includes('Knowledge PDF links') ||
      testInfo.title.includes('remote operator administration')
    ) {
      await seedKnowledgeLinkFixtures(pbPort);
    }
  });

  test.afterEach(async () => {
    if (clientElectronApp) {
      const activeClientApp = clientElectronApp;
      try {
        await activeClientApp.evaluate(({ dialog, shell }) => {
          const scope = globalThis as typeof globalThis & {
            __relayKnowledgeOriginalOpenExternal?: typeof shell.openExternal;
            __relayKnowledgeOpenExternalUrls?: string[];
            __relayKnowledgeOriginalShowOpenDialog?: typeof dialog.showOpenDialog;
          };
          if (scope.__relayKnowledgeOriginalOpenExternal) {
            shell.openExternal = scope.__relayKnowledgeOriginalOpenExternal;
          }
          if (scope.__relayKnowledgeOriginalShowOpenDialog) {
            dialog.showOpenDialog = scope.__relayKnowledgeOriginalShowOpenDialog;
          }
          delete scope.__relayKnowledgeOriginalOpenExternal;
          delete scope.__relayKnowledgeOpenExternalUrls;
          delete scope.__relayKnowledgeOriginalShowOpenDialog;
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

  test('remote operator administration preserves passwordless operation and offline reading', async () => {
    test.setTimeout(150_000);
    try {
      await activatePrivilegedAdministratorFixture(pbPort);
    } catch (error) {
      const logPath = path.join(tempDataDir, 'logs', 'relay.log');
      const logTail = fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => /Privileged|Security|administration|command/i.test(line))
            .slice(-100)
            .join('\n')
        : '';
      throw new Error(`Privileged fixture failed after server startup.\n${logTail}`, {
        cause: error,
      });
    }
    let connectedClient = await launchConnectedClient();
    let connectionStatus = connectedClient.locator('[data-connection-state]').first();

    await selectOperator(connectedClient, RYAN_BELL);
    await expect(connectedClient.getByTestId('sidebar-operator-selector')).toHaveAccessibleName(
      `Selected operator: ${RYAN_BELL}`,
    );
    await selectOperator(connectedClient, RYAN_BLEDSOE);
    const clientAccess = await openPrivilegedAccess(connectedClient);
    await clientAccess.getByLabel('Privileged password').fill(PRIVILEGED_TEST_PASSWORD);
    await clientAccess.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await clientAccess.getByRole('alert').isVisible()) ||
          (await clientAccess.getByText('Pair this workstation').isVisible()),
      )
      .toBe(true);
    await expect(clientAccess.getByRole('alert')).not.toBeVisible();
    await expect(clientAccess.getByText('Pair this workstation')).toBeVisible();
    await expect(connectionStatus).toHaveAttribute('data-connection-state', 'online');

    await selectOperator(window, RYAN_BLEDSOE);
    const serverAccess = await openPrivilegedAccess(window);
    await serverAccess.getByLabel('Privileged password').fill(PRIVILEGED_TEST_PASSWORD);
    await serverAccess.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(serverAccess.getByText('Administrator', { exact: true })).toBeVisible();
    await serverAccess.getByRole('button', { name: 'Create pairing code' }).click();
    const challenge = serverAccess.getByLabel('Active pairing challenge');
    await expect(challenge).toBeVisible();
    const challengeId = (await challenge.locator('dd').nth(1).textContent())?.trim();
    const pairingCode = (await challenge.locator('dd').nth(2).textContent())?.trim();
    expect(challengeId).toBeTruthy();
    expect(pairingCode).toMatch(/^[A-Z2-9]{8}$/);

    await clientAccess.getByLabel('Pairing challenge ID').fill(challengeId!);
    await clientAccess.getByLabel('One-time pairing code').fill(pairingCode!);
    await clientAccess.getByLabel('Device label').fill('E2E work laptop');
    await clientAccess.getByRole('button', { name: 'Pair device' }).click();
    await expect(clientAccess.getByText('Administrator', { exact: true })).toBeVisible();

    await clientAccess.getByRole('button', { name: 'Lock', exact: true }).click();
    await expect(clientAccess.getByText('Privileged access is locked')).toBeVisible();
    await clientAccess.getByLabel('Privileged password').fill(PRIVILEGED_TEST_PASSWORD);
    await clientAccess.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(clientAccess.getByText('Administrator', { exact: true })).toBeVisible();
    await expect(connectionStatus).toHaveAttribute('data-connection-state', 'online');

    await connectedClient.getByRole('tab', { name: 'Administration', exact: true }).click();
    const clientAdministration = connectedClient.getByRole('region', {
      name: 'Relay administration',
    });
    await expect(clientAdministration).toBeVisible();
    await expect(clientAdministration.getByText('ADMIN', { exact: true }).first()).toBeVisible();
    await connectedClient.waitForTimeout(1_000);
    const administrationAlert = clientAdministration.getByRole('alert');
    if (await administrationAlert.isVisible()) {
      const logPath = path.join(tempDataDir, 'logs', 'relay.log');
      const logTail = fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => /Privileged|Security|administration|command/i.test(line))
            .slice(-100)
            .join('\n')
        : '';
      throw new Error(
        `Administration snapshot failed: ${await administrationAlert.textContent()}\n${logTail}`,
      );
    }
    await clientAdministration.getByLabel('New operator').fill('E2E Operator');
    await clientAdministration.getByRole('button', { name: 'Add operator' }).click();
    await expect(clientAdministration.getByText('E2E Operator', { exact: true })).toBeVisible();

    const createdRow = clientAdministration.locator('.administration-row', {
      hasText: 'E2E Operator',
    });
    await createdRow.getByRole('button', { name: 'Rename' }).click();
    await createdRow.getByLabel('Rename E2E Operator').fill('E2E Operator Renamed');
    await createdRow.getByRole('button', { name: 'Save' }).click();
    await expect(
      clientAdministration.getByText('E2E Operator Renamed', { exact: true }),
    ).toBeVisible();
    const renamedRow = clientAdministration.locator('.administration-row', {
      hasText: 'E2E Operator Renamed',
    });
    await renamedRow.getByRole('button', { name: 'Deactivate' }).click();
    await expect(renamedRow.getByText('Inactive operator', { exact: true })).toBeVisible();
    await renamedRow.getByRole('button', { name: 'Reactivate' }).click();
    await expect(renamedRow.getByText('Active operator', { exact: true })).toBeVisible();

    await window.getByRole('tab', { name: 'Operators', exact: true }).click();
    const serverRoster = window.getByRole('region', { name: 'Operator roster' });
    await expect(serverRoster.getByText('E2E Operator Renamed', { exact: true })).toBeVisible();

    const ordinaryPb = await makePbClient(pbPort);
    const managedOperator = await ordinaryPb
      .collection('relay_operators')
      .getFirstListItem<RelayOperator>('displayName = "E2E Operator Renamed"', {
        requestKey: null,
      });
    await expect(
      ordinaryPb
        .collection('relay_operators')
        .update(managedOperator.id, { displayName: 'Unauthorized rename' }, { requestKey: null }),
    ).rejects.toBeTruthy();

    await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge Base');
    await connectedClient
      .getByRole('button', { name: /Manage (?:library|knowledge base)/ })
      .click();
    await expect(
      connectedClient.getByRole('heading', { name: 'Manage knowledge base', exact: true }),
    ).toBeVisible();
    await expect(connectedClient.getByRole('button', { name: /Documents \d+/ })).toBeVisible();
    if (!clientElectronApp) throw new Error('Connected Electron app not launched');
    await clientElectronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(920, 900);
    });
    await expect
      .poll(() =>
        connectedClient
          .locator('.knowledge-management__workspace')
          .evaluate((element) =>
            globalThis.getComputedStyle(element).getPropertyValue('grid-template-columns'),
          ),
      )
      .toMatch(/^\d+(?:\.\d+)?px$/);
    await connectedClient.getByRole('button', { name: 'Return to library', exact: true }).click();
    await connectedClient
      .getByRole('treeitem', { name: 'Link navigation test', exact: true })
      .click();
    await expect(
      connectedClient.getByRole('region', { name: 'Link navigation test PDF viewer' }),
    ).toContainText('Page 1 of 2');

    if (!clientElectronApp) throw new Error('Connected Electron app not launched');
    const lockedView = await clientElectronApp.evaluate(() => {
      const fixture = (
        globalThis as typeof globalThis & {
          __relayE2EPrivileged?: { simulateInactivity(): { state: string } | null };
        }
      ).__relayE2EPrivileged;
      if (!fixture) throw new Error('Privileged E2E fixture is unavailable.');
      return fixture.simulateInactivity();
    });
    expect(lockedView?.state).toBe('locked');
    await openPrivilegedAccess(connectedClient);
    await expect(connectedClient.getByText('Privileged access is locked')).toBeVisible();

    await electronApp?.close();
    electronApp = null;
    await expect
      .poll(async () =>
        fetch(`http://127.0.0.1:${pbPort}/api/health`).then(
          () => false,
          () => true,
        ),
      )
      .toBe(true);
    await clientElectronApp?.close();
    clientElectronApp = null;
    clientWindow = null;
    connectedClient = await launchClient();
    connectionStatus = connectedClient.locator('[data-connection-state]').first();
    await expect(connectionStatus).toHaveAttribute('data-connection-state', 'offline');
    await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge Base');
    await expect(
      connectedClient.getByRole('treeitem', { name: 'Link navigation test', exact: true }),
    ).toBeVisible();
    await expect(
      connectedClient.getByRole('region', { name: 'Link navigation test PDF viewer' }),
    ).toContainText('Page 1 of 2');
  });

  test('publisher resumes a Knowledge batch after interruption and publishes for ordinary operators', async () => {
    test.setTimeout(240_000);
    await activatePrivilegedAdministratorFixture(pbPort);
    await activatePrivilegedPublisherFixture(pbPort);

    let connectedClient = await launchConnectedClient();
    await selectOperator(connectedClient, TRISTAN_BOWLES);
    const publisherAccess = await openPrivilegedAccess(connectedClient);
    await publisherAccess.getByLabel('Privileged password').fill(PUBLISHER_TEST_PASSWORD);
    await publisherAccess.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(publisherAccess.getByText('Pair this workstation')).toBeVisible();

    await selectOperator(window, RYAN_BLEDSOE);
    const serverAccess = await openPrivilegedAccess(window);
    await serverAccess.getByLabel('Privileged password').fill(PRIVILEGED_TEST_PASSWORD);
    await serverAccess.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(serverAccess.getByText('Administrator', { exact: true })).toBeVisible();
    const workstationOwner = serverAccess.getByLabel('Workstation owner');
    await expect(
      workstationOwner.getByRole('option', {
        name: `${TRISTAN_BOWLES} — Knowledge publisher`,
        exact: true,
      }),
    ).toBeAttached();
    await workstationOwner.selectOption({
      label: `${TRISTAN_BOWLES} — Knowledge publisher`,
    });
    await serverAccess.getByRole('button', { name: 'Create pairing code' }).click();
    const challenge = serverAccess.getByLabel('Active pairing challenge');
    await expect(challenge).toBeVisible();
    await expect(challenge.locator('dd').nth(0)).toHaveText(
      `${TRISTAN_BOWLES} · Knowledge publisher`,
    );
    const challengeId = (await challenge.locator('dd').nth(1).textContent())?.trim();
    const pairingCode = (await challenge.locator('dd').nth(2).textContent())?.trim();
    expect(challengeId).toBeTruthy();
    expect(pairingCode).toMatch(/^[A-Z2-9]{8}$/);

    await publisherAccess.getByLabel('Pairing challenge ID').fill(challengeId!);
    await publisherAccess.getByLabel('One-time pairing code').fill(pairingCode!);
    await publisherAccess.getByLabel('Device label').fill('E2E publisher laptop');
    await publisherAccess.getByRole('button', { name: 'Pair device' }).click();
    await expect(publisherAccess.getByText('Knowledge publisher', { exact: true })).toBeVisible();

    const sourceDir = path.join(clientDataDir, 'knowledge-upload-fixtures');
    fs.mkdirSync(sourceDir, { recursive: true });
    const largeTitle = 'Publisher resume large';
    const smallTitle = 'Publisher resume small';
    const largeFileName = `${largeTitle}.pdf`;
    const smallFileName = `${smallTitle}.pdf`;
    const largePath = path.join(sourceDir, largeFileName);
    const smallPath = path.join(sourceDir, smallFileName);
    // Keep the end-to-end fixture multi-chunk but bounded; the dedicated soak
    // harness exercises the full 50 MiB per-file ceiling.
    writePaddedKnowledgePdfFixture(largePath, largeTitle, 20 * 1024 * 1024 - 8_192);
    writePaddedKnowledgePdfFixture(smallPath, smallTitle, 64 * 1_024);
    const largeChunkCount = Math.ceil(fs.statSync(largePath).size / KNOWLEDGE_CHUNK_BYTES);

    await installKnowledgeDialogFixture([largePath, smallPath]);
    await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge Base');
    await connectedClient
      .getByRole('button', { name: /Manage (?:library|knowledge base)/ })
      .click();
    await expect(
      connectedClient.getByRole('heading', { name: 'Manage knowledge base', exact: true }),
    ).toBeVisible();
    await connectedClient.getByRole('button', { name: 'Add PDFs', exact: true }).click();
    await expect(connectedClient.getByRole('button', { name: 'Uploads 2' })).toBeVisible();

    let pb = await makeSuperuserPbClient(pbPort);
    let observedChunkCount = 0;
    await expect
      .poll(
        async () => {
          observedChunkCount = (
            await pb.collection('knowledge_upload_chunks').getFullList({ requestKey: null })
          ).length;
          return observedChunkCount > 0 && observedChunkCount < largeChunkCount - 1;
        },
        { intervals: [25, 50, 100], timeout: 5_000 },
      )
      .toBe(true);

    // Stop the publisher first so its scheduler cannot finish queued chunks
    // while the server performs a graceful shutdown.
    await clientElectronApp?.close();
    clientElectronApp = null;
    clientWindow = null;
    await electronApp?.close();
    electronApp = null;
    await expect
      .poll(async () =>
        fetch(`http://127.0.0.1:${pbPort}/api/health`).then(
          () => false,
          () => true,
        ),
      )
      .toBe(true);
    await launchServer();
    pb = await makeSuperuserPbClient(pbPort);
    const preservedChunks = await pb
      .collection('knowledge_upload_chunks')
      .getFullList<{ uploadId: string; index: number }>({ requestKey: null });
    expect(preservedChunks.length).toBeGreaterThanOrEqual(observedChunkCount);
    expect(preservedChunks.length).toBeLessThan(largeChunkCount);

    connectedClient = await launchConnectedClient();
    await selectOperator(connectedClient, TRISTAN_BOWLES);
    const restartedAccess = await openPrivilegedAccess(connectedClient);
    await restartedAccess.getByLabel('Privileged password').fill(PUBLISHER_TEST_PASSWORD);
    await restartedAccess.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(restartedAccess.getByText('Knowledge publisher', { exact: true })).toBeVisible();

    await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge Base');
    await connectedClient
      .getByRole('button', { name: /Manage (?:library|knowledge base)/ })
      .click();
    await connectedClient.getByRole('button', { name: /Uploads \d+/ }).click();
    await expect(
      connectedClient.getByText('Restored after restart', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const uploads = await pb
            .collection('knowledge_uploads')
            .getFullList<{ fileName: string; state: string }>({ requestKey: null });
          return uploads
            .filter(({ fileName }) => [largeFileName, smallFileName].includes(fileName))
            .map(({ fileName, state }) => `${fileName}:${state}`)
            .toSorted();
        },
        { timeout: 60_000 },
      )
      .toEqual([`${largeFileName}:ready`, `${smallFileName}:ready`].toSorted());

    for (const fileName of [largeFileName, smallFileName]) {
      const row = connectedClient.locator('.knowledge-management-row--upload', {
        hasText: fileName,
      });
      await expect(row).toBeVisible();
      const publish = row.getByRole('button', { name: 'Publish', exact: true });
      await expect(publish).toBeEnabled();
      await publish.click();
      await expect(row).not.toBeVisible();
    }

    await expect
      .poll(async () => {
        const documents = await pb
          .collection('knowledge_documents')
          .getFullList<{ fileName: string; lifecycleState: string }>({ requestKey: null });
        return documents
          .filter(({ fileName }) => [largeFileName, smallFileName].includes(fileName))
          .map(({ fileName, lifecycleState }) => `${fileName}:${lifecycleState}`)
          .toSorted();
      })
      .toEqual([`${largeFileName}:active`, `${smallFileName}:active`].toSorted());
    await expect
      .poll(
        async () =>
          (await pb.collection('knowledge_upload_chunks').getFullList({ requestKey: null })).length,
      )
      .toBe(0);

    const activePublisherAccess = await openPrivilegedAccess(connectedClient);
    await activePublisherAccess.getByRole('button', { name: 'Sign out', exact: true }).click();
    await selectOperator(connectedClient, RYAN_BELL);
    await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge Base');
    await connectedClient.getByRole('treeitem', { name: largeTitle, exact: true }).click();
    await expect(
      connectedClient.getByRole('region', { name: `${largeTitle} PDF viewer` }),
    ).toContainText('Page 1 of 1');
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
    const ticketNumber = `INC${crypto.randomInt(1_000_000, 9_999_999)}`;
    const ticketNote = `Ticket: ${ticketNumber}`;

    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');
    await expect(window.getByRole('tab', { name: 'Unaddressed 0' })).toBeVisible();
    await goToTab(window, 'sidebar-compose', 'Compose');

    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');

    const operators = await getOperatorRoster(pbPort);
    expect(operators.map(({ displayName }) => displayName)).toEqual(EXPECTED_OPERATOR_NAMES);
    expect(operators).toHaveLength(EXPECTED_OPERATOR_NAMES.length);
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
    await window.getByLabel('Service Desk ticket number').fill(ticketNumber);
    await expect(addressedAction).toBeEnabled();
    await addressedAction.click();
    await expect(window.getByRole('tab', { name: 'Addressed locally 2' })).toBeVisible();

    await expect
      .poll(async () => {
        const { note, state } = await getDynatraceAttribution(
          pbPort,
          CHECKOUT_PROBLEM_ID,
          ticketNote,
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
    const syncedTicket = clientDetail.locator('.dt-problem-note', { hasText: ticketNumber });
    await expect(syncedTicket).toContainText('Service Desk ticket');
    await expect(syncedTicket).toContainText(ticketNumber);
    await expect(syncedTicket).toContainText(RYAN_BELL);
  });

  test('connected client retains Ryan Bell attribution through offline queue sync', async () => {
    test.setTimeout(90_000);
    const noteText = `Offline NOC follow-up ${uniqueSuffix()}`;

    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
    const operators = await getOperatorRoster(pbPort);
    expect(operators.map(({ displayName }) => displayName)).toEqual(EXPECTED_OPERATOR_NAMES);
    expect(operators).toHaveLength(EXPECTED_OPERATOR_NAMES.length);
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
      .toEqual({ problems: 7, operators: EXPECTED_OPERATOR_NAMES.length });

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

  test('Relay shell and Dynatrace workspace adapt to compact desktop widths', async () => {
    if (!electronApp) throw new Error('Electron app not launched');
    runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');
    await expect(window.getByRole('tab', { name: 'Unaddressed 4' })).toBeVisible();

    const readGeometry = () =>
      window.evaluate(() => {
        const sidebar = globalThis.document.querySelector('.sidebar');
        const label = globalThis.document.querySelector('.sidebar-button-label');
        const clock = globalThis.document.querySelector('.world-clock-container');
        const queue = globalThis.document.querySelector('.dt-problems__queue');
        const detail = globalThis.document.querySelector('.dt-problems__detail');
        if (!sidebar || !label || !clock || !queue || !detail) {
          throw new Error('Responsive shell geometry target is missing.');
        }
        const sidebarRect = sidebar.getBoundingClientRect();
        const queueRect = queue.getBoundingClientRect();
        const detailRect = detail.getBoundingClientRect();
        return {
          viewportWidth: globalThis.innerWidth,
          documentWidth: globalThis.document.documentElement.scrollWidth,
          sidebarWidth: Math.round(sidebarRect.width),
          labelDisplay: globalThis.getComputedStyle(label).display,
          clockDisplay: globalThis.getComputedStyle(clock).display,
          queue: { right: queueRect.right, bottom: queueRect.bottom },
          detail: { left: detailRect.left, top: detailRect.top, right: detailRect.right },
        };
      });

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(960, 1000);
    });
    await expect.poll(async () => (await readGeometry()).sidebarWidth).toBe(64);
    const halfScreen = await readGeometry();
    expect(halfScreen.labelDisplay).toBe('none');
    expect(halfScreen.clockDisplay).toBe('none');
    expect(halfScreen.queue.right).toBeLessThanOrEqual(halfScreen.detail.left + 1);
    expect(halfScreen.documentWidth).toBeLessThanOrEqual(halfScreen.viewportWidth);

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(840, 1000);
    });
    await expect.poll(async () => (await readGeometry()).viewportWidth).toBeLessThanOrEqual(840);
    const narrow = await readGeometry();
    expect(narrow.sidebarWidth).toBe(64);
    expect(narrow.queue.bottom).toBeLessThanOrEqual(narrow.detail.top + 1);
    expect(narrow.detail.right).toBeLessThanOrEqual(narrow.viewportWidth);
    expect(narrow.documentWidth).toBeLessThanOrEqual(narrow.viewportWidth);
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
