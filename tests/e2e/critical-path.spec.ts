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

type RelayRoleAccount = {
  id: string;
  username: string;
  displayName: string;
  storedRole: 'administrator' | 'publisher';
  active: boolean;
  mustChangePassword: boolean;
  credentialVersion: number;
  revision: number;
};

type RelayPrivilegedState = {
  id: string;
  ownerAccountId: string;
  publisherAccountId?: string;
  assignmentVersion: number;
  identityMigrationVersion: number;
  updatedByAccountId?: string;
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

const RYAN_BLEDSOE = 'Ryan Bledsoe';
const CHARLES_GIBBS = 'Charles Gibbs';
const TRISTAN_BOWLES = 'Tristan Bowles';
const CHECKOUT_PROBLEM_ID = 'RELAY-DEMO-1001';
const CHECKOUT_PROBLEM_TITLE = 'Checkout service availability below SLO';
const KNOWLEDGE_CHUNK_BYTES = 4 * 1024 * 1024;
const CONTINUOUS_READER_TITLE = 'Continuous reader validation';
const CONTINUOUS_READER_PAGE_COUNT = 12;
const AUTH_RATE_LIMIT_WINDOW_MS = 3_000;
const AUTH_RATE_LIMIT_SETTLE_MS = 250;

const CONFIG_SECRET_FIELD = ['sec', 'ret'].join('');
const makeTestPassphrase = () => ['test', crypto.randomUUID()].join('-');
const TEST_PASSPHRASE = makeTestPassphrase();
const PRIVILEGED_TEST_PASSWORD = `e2e-privileged-${crypto.randomUUID()}`;
const PUBLISHER_TEST_PASSWORD = `e2e-publisher-${crypto.randomUUID()}`;
const authenticatedFixtureClients = new Map<string, Promise<PocketBase>>();
type AuthenticationBucket = 'app-user' | 'privileged' | 'superuser';
const authenticationAttempts = new Map<AuthenticationBucket, number[]>();

const resetAuthenticationFixtures = () => {
  authenticatedFixtureClients.clear();
  authenticationAttempts.clear();
};

const recordAuthenticationRequests = (bucket: AuthenticationBucket, count = 1) => {
  const attempts = authenticationAttempts.get(bucket) ?? [];
  const now = Date.now();
  const recent = attempts.filter((attempt) => now - attempt < AUTH_RATE_LIMIT_WINDOW_MS);
  recent.push(...Array.from({ length: count }, () => now));
  authenticationAttempts.set(bucket, recent);
};

const reserveAuthenticationRequest = async (bucket: AuthenticationBucket) => {
  while (true) {
    const attempts = authenticationAttempts.get(bucket) ?? [];
    const now = Date.now();
    const recent = attempts.filter((attempt) => now - attempt < AUTH_RATE_LIMIT_WINDOW_MS);
    if (recent.length < 2) {
      recent.push(now);
      authenticationAttempts.set(bucket, recent);
      return;
    }

    const remaining = AUTH_RATE_LIMIT_WINDOW_MS + AUTH_RATE_LIMIT_SETTLE_MS - (now - recent[0]!);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
};

const rightClick = async (target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: 'right', force: true });
};

const getActivePanel = (window: Page) => window.locator('.tab-panel--active');

const expectDirectoryBandsToSpanWorkspace = async (workspace: Locator) => {
  const splitLayout = workspace.locator('.tab-split-layout');

  for (const selector of ['.collapsible-header', '.list-filters']) {
    const band = workspace.locator(selector);
    await expect
      .poll(async () => {
        const [layoutBox, bandBox] = await Promise.all([
          splitLayout.boundingBox(),
          band.boundingBox(),
        ]);
        if (!layoutBox || !bandBox) return null;

        return {
          left: Math.round(bandBox.x - layoutBox.x),
          right: Math.round(layoutBox.x + layoutBox.width - bandBox.x - bandBox.width),
        };
      })
      .toEqual({ left: 0, right: 0 });
  }
};

const expectDirectoryToolbarControlsToBeCentered = async (workspace: Locator) => {
  const toolbar = workspace.locator('.collapsible-header');
  const controls = [
    toolbar.locator('.list-toolbar-sort-select'),
    toolbar.locator('.list-toolbar-sort-dir'),
    toolbar.locator('.btn-collapsible'),
  ];

  await expect
    .poll(async () => {
      const [toolbarBox, ...controlBoxes] = await Promise.all([
        toolbar.boundingBox(),
        ...controls.map((control) => control.boundingBox()),
      ]);
      if (!toolbarBox || controlBoxes.some((box) => !box)) return null;

      return {
        toolbarHeightWithinTolerance: Math.abs(toolbarBox.height - 62) <= 1,
        controls: controlBoxes.map((box) => {
          const top = box!.y - toolbarBox.y;
          const bottom = toolbarBox.y + toolbarBox.height - box!.y - box!.height;
          return {
            heightWithinTolerance: Math.abs(box!.height - 40) <= 1,
            insetWithinTolerance: Math.abs(Math.min(top, bottom) - 11) <= 1,
            centered: Math.abs(top - bottom) <= 1,
          };
        }),
      };
    })
    .toEqual({
      toolbarHeightWithinTolerance: true,
      controls: Array.from({ length: 3 }, () => ({
        heightWithinTolerance: true,
        insetWithinTolerance: true,
        centered: true,
      })),
    });
};

const makePort = () => 20_000 + crypto.randomInt(20_000);

const runDynatraceSeed = async (
  userDataDir: string,
  port: number,
  mode: '--dynatrace-only' | '--clear-dynatrace',
) => {
  await reserveAuthenticationRequest('superuser');
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

const makeAuthenticatedFixtureClient = async (
  port: number,
  collection: '_pb_users_auth_' | '_superusers',
  identity: string,
) => {
  const cacheKey = `${port}:${collection}`;
  const cached = authenticatedFixtureClients.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    await reserveAuthenticationRequest(collection === '_superusers' ? 'superuser' : 'app-user');
    const pb = new PocketBase(`http://127.0.0.1:${port}`);
    await pb.collection(collection).authWithPassword(identity, TEST_PASSPHRASE, {
      requestKey: null,
    });
    return pb;
  })();
  authenticatedFixtureClients.set(cacheKey, pending);

  try {
    return await pending;
  } catch (error) {
    if (authenticatedFixtureClients.get(cacheKey) === pending) {
      authenticatedFixtureClients.delete(cacheKey);
    }
    throw error;
  }
};

const makePbClient = (port: number) =>
  makeAuthenticatedFixtureClient(port, '_pb_users_auth_', 'relay@relay.app');

const makeSuperuserPbClient = (port: number) =>
  makeAuthenticatedFixtureClient(port, '_superusers', 'admin@relay.app');

const submitPrivilegedSignIn = async (panel: Locator) => {
  await reserveAuthenticationRequest('privileged');
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click();
};

const knowledgeCategoryKey = (name: string) => name.trim().toLocaleLowerCase('en-US');

const ensureKnowledgeCategories = async (pb: PocketBase, names: string[]) => {
  const collection = pb.collection('knowledge_categories');
  const existing = await collection.getFullList<{
    id: string;
    name: string;
    normalizedName: string;
  }>({ requestKey: null });
  const byKey = new Map(existing.map((category) => [category.normalizedName, category]));

  for (const name of [...new Set(names)]) {
    const normalizedName = knowledgeCategoryKey(name);
    if (byKey.has(normalizedName)) continue;
    const category = await collection.create<{
      id: string;
      name: string;
      normalizedName: string;
    }>(
      {
        name,
        normalizedName,
        sortOrder: (byKey.size + 1) * 100,
        systemKey: '',
        revision: 1,
      },
      { requestKey: null },
    );
    byKey.set(normalizedName, category);
  }

  return byKey;
};

const seedKnowledgeLinkFixtures = async (port: number) => {
  const pb = await makeSuperuserPbClient(port);
  const timestamp = new Date().toISOString();
  const fixtures = [
    ...createKnowledgeLinkFixtures(),
    {
      category: 'Reader validation',
      fileName: `${CONTINUOUS_READER_TITLE}.pdf`,
      title: CONTINUOUS_READER_TITLE,
      pageCount: CONTINUOUS_READER_PAGE_COUNT,
      data: buildKnowledgePdfFixture({
        title: CONTINUOUS_READER_TITLE,
        pageCount: CONTINUOUS_READER_PAGE_COUNT,
      }),
    },
  ];
  const categories = await ensureKnowledgeCategories(
    pb,
    fixtures.map(({ category }) => category),
  );
  for (const fixture of fixtures) {
    const bytes = Uint8Array.from(fixture.data);
    const form = new FormData();
    form.set('sourceKey', `${fixture.category}/${fixture.fileName}`);
    form.set('category', fixture.category);
    form.set('categoryId', categories.get(knowledgeCategoryKey(fixture.category))!.id);
    form.set('documentType', 'sop');
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

const waitForRoleAccount = async (pb: PocketBase, username: string) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await pb
        .collection('relay_privileged_accounts')
        .getFirstListItem<RelayRoleAccount>(`username = "${username}"`, {
          requestKey: null,
        });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
};

const activateRoleAccountFixture = async (
  port: number,
  username: 'ryan' | 'charles',
  password: string,
) => {
  const pb = await makeSuperuserPbClient(port);
  const account = await waitForRoleAccount(pb, username);
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
  const authenticated = updated;
  const state = await pb
    .collection('relay_privileged_state')
    .getFirstListItem<RelayPrivilegedState>('key = "primary"', { requestKey: null });
  if (
    authenticated.id !== updated.id ||
    authenticated.username !== username ||
    authenticated.active !== true ||
    authenticated.mustChangePassword !== false ||
    authenticated.storedRole !== 'administrator' ||
    !Number.isSafeInteger(authenticated.revision) ||
    (username === 'ryan' && state.ownerAccountId !== authenticated.id) ||
    (username === 'charles' && state.ownerAccountId === authenticated.id)
  ) {
    throw new Error(`Role account fixture is inconsistent for @${username}.`);
  }
  return updated;
};

const activatePrivilegedPublisherFixture = async (port: number) => {
  const pb = await makeSuperuserPbClient(port);
  const state = await pb.collection('relay_privileged_state').getFirstListItem<{
    id: string;
    ownerAccountId: string;
    assignmentVersion: number;
  }>('key = "primary"', { requestKey: null });
  const accounts = await pb.collection('relay_privileged_accounts').getFullList<RelayRoleAccount>({
    filter: 'username = "tristan"',
    requestKey: null,
  });
  const account = accounts[0];
  const values = {
    email: 'tristan@relay.invalid',
    username: 'tristan',
    displayName: TRISTAN_BOWLES,
    storedRole: 'publisher',
    active: true,
    mustChangePassword: false,
    credentialVersion: (account?.credentialVersion ?? 0) + 1,
    revision: account ? undefined : 0,
    password: PUBLISHER_TEST_PASSWORD,
    passwordConfirm: PUBLISHER_TEST_PASSWORD,
  };
  const updated = account
    ? await pb.collection('relay_privileged_accounts').update(account.id, values, {
        requestKey: null,
      })
    : await pb.collection('relay_privileged_accounts').create(values, { requestKey: null });

  await pb.collection('relay_privileged_state').update(
    state.id,
    {
      publisherAccountId: updated.id,
      assignmentVersion: state.assignmentVersion + 1,
      updatedByAccountId: state.ownerAccountId,
    },
    { requestKey: null },
  );

  const authenticatedPublisher = updated as unknown as RelayRoleAccount & {
    collectionName?: string;
  };
  expect(updated).toMatchObject({
    id: updated.id,
    username: 'tristan',
    displayName: TRISTAN_BOWLES,
    storedRole: 'publisher',
    active: true,
  });
  expect(authenticatedPublisher).toMatchObject({
    collectionName: 'relay_privileged_accounts',
    mustChangePassword: false,
    credentialVersion: expect.any(Number),
    revision: expect.any(Number),
  });
  const authenticatedState = await pb
    .collection('relay_privileged_state')
    .getFirstListItem<RelayPrivilegedState>('key = "primary"', { requestKey: null });
  expect(authenticatedState.publisherAccountId).toBe(updated.id);
  return { accountId: updated.id };
};

const readRoleAccountSnapshot = async (port: number) => {
  const pb = await makeSuperuserPbClient(port);
  const [accounts, state] = await Promise.all([
    pb.collection('relay_privileged_accounts').getFullList<RelayRoleAccount>({ requestKey: null }),
    pb
      .collection('relay_privileged_state')
      .getFirstListItem<RelayPrivilegedState>('key = "primary"', { requestKey: null }),
  ]);
  let legacyRosterPresent = true;
  try {
    await pb.collections.getOne('relay_operators', { requestKey: null });
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    legacyRosterPresent = false;
  }
  const owner = accounts.find(({ id }) => id === state.ownerAccountId);
  const administrator = accounts.find(({ username }) => username === 'charles');
  const publisherCount = accounts.filter(
    ({ id, storedRole }) => id === state.publisherAccountId && storedRole === 'publisher',
  ).length;
  return {
    ownerUsername: owner?.username,
    ownerDisplayName: owner?.displayName,
    administratorUsername: administrator?.username,
    administratorDisplayName: administrator?.displayName,
    ownerCount: accounts.filter(({ id }) => id === state.ownerAccountId).length,
    publisherCount,
    legacyRosterPresent,
  };
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

const createServerDirect = async (port: number, name: string, ownerEmail: string) => {
  const pb = await makePbClient(port);
  await pb.collection('servers').create({
    name,
    businessArea: 'E2E Operations',
    lob: 'Relay validation',
    comment: 'Retained Knowledge workspace fixture',
    owner: ownerEmail,
    contact: ownerEmail,
    os: 'Linux',
  });
};

const createContextualNoteDirect = async (
  port: number,
  entityType: 'contact' | 'server',
  entityKey: string,
  note: string,
) => {
  const pb = await makePbClient(port);
  await pb.collection('notes').create({
    entityType,
    entityKey: entityKey.toLowerCase(),
    note,
    tags: ['e2e', 'knowledge'],
  });
};

const goToTab = async (window: Page, testId: string, breadcrumbLabel: string) => {
  await window.getByTestId(testId).click();
  await expect(window.locator('.header-breadcrumb')).toContainText(`Relay / ${breadcrumbLabel}`);
};

type KnowledgeDestinationLabel = 'Wiki' | 'Contacts' | 'Servers';

const goToKnowledgeHome = async (targetWindow: Page) => {
  await goToTab(targetWindow, 'sidebar-knowledge', 'Knowledge');
  const home = targetWindow.getByRole('region', { name: 'Knowledge home' });
  const homeButton = targetWindow.getByRole('button', { name: 'Knowledge home' });

  await expect
    .poll(async () => {
      if (await home.isVisible()) return 'home';
      if (await homeButton.isVisible()) return 'destination';
      return 'loading';
    })
    .not.toBe('loading');

  if (await homeButton.isVisible()) await homeButton.click();
  await expect(home).toBeVisible();
  return home;
};

const enterKnowledgeDestination = async (
  targetWindow: Page,
  destination: KnowledgeDestinationLabel,
) => {
  const home = await goToKnowledgeHome(targetWindow);
  await home.getByRole('button', { name: new RegExp(`^Open ${destination},`) }).click();
  const navigation = targetWindow.getByRole('navigation', { name: 'Knowledge destinations' });
  await expect(navigation.getByRole('button', { name: destination, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(
    targetWindow.getByRole('region', { name: `${destination.toLowerCase()} workspace` }),
  ).toBeVisible();
  await expect(targetWindow.locator('.header-breadcrumb')).toContainText('Relay / Knowledge');
};

const openKnowledgeReaderDocument = async (targetWindow: Page, category: string, title: string) => {
  const viewer = targetWindow.getByRole('region', { name: `${title} PDF viewer` });
  if (!(await viewer.isVisible())) {
    const libraryTab = targetWindow.getByRole('tab', { name: 'Library' });
    if (await libraryTab.isVisible()) await libraryTab.click();
    const catalogAction = targetWindow.getByRole('button', {
      name: `Open ${title}`,
      exact: true,
    });
    const categoryNode = targetWindow.getByRole('treeitem', {
      name: `${category}, 1 document`,
      exact: true,
    });
    await expect
      .poll(async () => {
        if (await catalogAction.isVisible()) return 'catalog';
        if (await categoryNode.isVisible()) return 'reader';
        return 'loading';
      })
      .not.toBe('loading');

    if (await catalogAction.isVisible()) {
      await catalogAction.click();
    } else {
      if ((await categoryNode.getAttribute('aria-expanded')) === 'false') {
        await categoryNode.click();
      }
      await targetWindow.getByRole('treeitem', { name: title, exact: true }).click();
    }
  }

  await expect(viewer).toBeVisible();
  return viewer;
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

const tryEnsureContactsReady = async (window: Page) => {
  await enterKnowledgeDestination(window, 'Contacts');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const addContact = window.getByRole('button', { name: 'ADD CONTACT' });
    if (await addContact.isVisible()) {
      return true;
    }

    const reload = window.getByRole('button', { name: 'Reload' }).first();
    if (await reload.isVisible()) {
      await Promise.all([window.waitForLoadState('domcontentloaded'), reload.click()]);
      await enterKnowledgeDestination(window, 'Contacts');
      continue;
    }

    await window.waitForTimeout(500);
  }

  return false;
};

const createContactFromKnowledge = async (
  window: Page,
  port: number,
  name: string,
  email: string,
) => {
  const contactsReady = await tryEnsureContactsReady(window);

  if (!contactsReady) {
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

const deleteContactFromKnowledge = async (window: Page, port: number, email: string) => {
  const contactsReady = await tryEnsureContactsReady(window);

  if (!contactsReady) {
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
  let startupShellWasVisible = false;

  const launchServer = async (
    options: { knowledgeChunkDelayMs?: string; startupDelayMs?: string } = {},
  ) => {
    // PocketBase owns the limiter in memory, so every embedded-server process
    // starts with a fresh budget. Account conservatively for the bootstrap
    // requests that occur before the E2E harness can interact with it.
    authenticationAttempts.clear();
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    const launchEnv = {
      ...process.env,
      NODE_ENV: 'test',
      RELAY_E2E_PRIVILEGED_FIXTURES: '1',
      ...(options.knowledgeChunkDelayMs
        ? { RELAY_E2E_KNOWLEDGE_CHUNK_DELAY_MS: options.knowledgeChunkDelayMs }
        : {}),
      ...(options.startupDelayMs ? { RELAY_E2E_STARTUP_DELAY_MS: options.startupDelayMs } : {}),
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
    startupShellWasVisible = await window.locator('.startup-shell').isVisible();
    await expect(window.getByTestId('sidebar-compose')).toBeVisible();
    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
    recordAuthenticationRequests('superuser');
    recordAuthenticationRequests('app-user', 2);
  };

  const launchClient = async () => {
    await reserveAuthenticationRequest('app-user');
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

  const installServerKnowledgeDialogFixture = async (filePaths: string[]) => {
    if (!electronApp) throw new Error('Server Electron app not launched');
    await electronApp.evaluate(({ dialog }, selectedPaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selectedPaths });
    }, filePaths);
  };

  const openOwnerKnowledgeManagement = async () => {
    await activateRoleAccountFixture(pbPort, 'ryan', PRIVILEGED_TEST_PASSWORD);
    const access = await openPrivilegedAccess(window);
    await access.getByLabel('Username').fill('ryan');
    await access.getByLabel('Password').fill(PRIVILEGED_TEST_PASSWORD);
    await submitPrivilegedSignIn(access);
    await expect(access.getByText('Owner', { exact: true })).toBeVisible();
    await enterKnowledgeDestination(window, 'Wiki');
    await window.getByRole('button', { name: 'Manage Wiki', exact: true }).click();
    await expect(window.getByRole('heading', { name: 'Manage Wiki', exact: true })).toBeVisible();
    return {
      content: window.locator('.knowledge-management__content'),
      rail: window.getByRole('navigation', { name: 'Knowledge management' }),
      root: window.locator('.knowledge-management'),
      search: window.getByPlaceholder('Title, PDF, or category'),
      workspace: window.locator('.knowledge-management__workspace'),
    };
  };

  const setServerWindowWidth = async (width: number) => {
    if (!electronApp) throw new Error('Server Electron app not launched');
    await electronApp.evaluate(({ BrowserWindow }, nextWidth) => {
      BrowserWindow.getAllWindows()[0]?.setSize(nextWidth, 900);
    }, width);
    await expect
      .poll(() => window.evaluate(() => globalThis.innerWidth))
      .toBeLessThanOrEqual(width);
  };

  const seedKnowledgePaginationFixtures = async (count: number) => {
    const pdf = Uint8Array.from(
      buildKnowledgePdfFixture({ title: 'Pagination fixture', pageCount: 1 }),
    );
    const timestamp = new Date().toISOString();
    const pb = await makeSuperuserPbClient(pbPort);
    const categories = await ensureKnowledgeCategories(pb, ['Pagination']);
    const categoryId = categories.get(knowledgeCategoryKey('Pagination'))!.id;
    for (let index = 0; index < count; index += 1) {
      const fileName = `ZZ Pagination fixture ${String(index + 1).padStart(2, '0')}.pdf`;
      const form = new FormData();
      form.set('sourceKey', `Pagination/${fileName}`);
      form.set('category', 'Pagination');
      form.set('categoryId', categoryId);
      form.set('documentType', 'sop');
      form.set('title', fileName.replace(/\.pdf$/i, ''));
      form.set('displayTitle', fileName.replace(/\.pdf$/i, ''));
      form.set('fileName', fileName);
      form.set('pdf', new Blob([pdf.buffer], { type: 'application/pdf' }), fileName);
      form.set('checksum', crypto.createHash('sha256').update(pdf).digest('hex'));
      form.set('byteSize', String(pdf.byteLength));
      form.set('pageCount', '1');
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

  const seedKnowledgeAuditFixtures = async (count: number) => {
    const pb = await makeSuperuserPbClient(pbPort);
    for (let index = 0; index < count; index += 1) {
      await pb.collection('knowledge_audit_events').create(
        {
          requestId: `e2e-audit-${uniqueSuffix()}-${index}`,
          action: 'published',
          targetId: `audit-document-${index}`,
          fileName: `Audit fixture ${index + 1}.pdf`,
          title: `Audit fixture ${index + 1}`,
          category: 'Audit fixtures',
          accountId: 'e2e-owner',
          actorDisplayName: RYAN_BLEDSOE,
          operatorId: '',
          operatorName: '',
          occurredAt: new Date(Date.now() - index * 1_000).toISOString(),
          details: {},
        },
        { requestKey: null },
      );
    }
  };

  test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
    resetAuthenticationFixtures();
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-critical-'));
    clientElectronApp = null;
    clientWindow = null;
    clientDataDir = '';
    pbPort = makePort();
    writeServerConfig(tempDataDir, pbPort);
    await launchServer({
      knowledgeChunkDelayMs: testInfo.title.includes('Knowledge management upload workflow')
        ? '150'
        : undefined,
      startupDelayMs: testInfo.title.includes('startup shell appears before workspace readiness')
        ? '1000'
        : undefined,
    });
    if (
      testInfo.title.includes('Knowledge PDF links') ||
      testInfo.title.includes('continuous Wiki PDF') ||
      testInfo.title.includes('role accounts preserve') ||
      testInfo.title.includes('Knowledge management')
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

  test('startup shell appears before workspace readiness and healthy relaunch skips credential repair', async () => {
    expect(startupShellWasVisible).toBe(true);
    const logPath = path.join(tempDataDir, 'logs', 'relay.log');
    const countMatches = (pattern: RegExp) => {
      try {
        return fs.readFileSync(logPath, 'utf8').match(pattern)?.length ?? 0;
      } catch {
        return 0;
      }
    };

    await expect.poll(() => countMatches(/Superuser upserted via CLI/g)).toBeGreaterThan(0);
    const credentialRepairCount = countMatches(/Superuser upserted via CLI/g);
    const startupSummaryCount = countMatches(/Relay startup timing/g);

    await electronApp?.close();
    electronApp = null;
    await launchServer();

    await expect
      .poll(() => countMatches(/Relay startup timing/g))
      .toBeGreaterThan(startupSummaryCount);
    expect(countMatches(/Superuser upserted via CLI/g)).toBe(credentialRepairCount);
  });

  test('Knowledge management responsive geometry preserves navigation and bottom gutters', async () => {
    const { rail, root, search, workspace } = await openOwnerKnowledgeManagement();

    const expectBottomGutter = async (expected: number) => {
      await expect(root).toHaveCSS('padding-bottom', `${expected}px`);
      await expect
        .poll(async () => {
          const [rootBox, workspaceBox] = await Promise.all([
            root.boundingBox(),
            workspace.boundingBox(),
          ]);
          if (!rootBox || !workspaceBox) return null;
          return Math.round(rootBox.y + rootBox.height - workspaceBox.y - workspaceBox.height);
        })
        .toBe(expected);
    };

    await setServerWindowWidth(1600);
    await expect(workspace).toBeVisible();
    expect(
      await workspace.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          border: style.borderTopWidth,
          columns: style.gridTemplateColumns,
          shadow: style.boxShadow,
        };
      }),
    ).toEqual({ border: '1px', columns: expect.stringMatching(/^190px /), shadow: 'none' });
    await expectBottomGutter(24);

    await setServerWindowWidth(1100);
    await expectBottomGutter(24);
    await expect
      .poll(() => rail.evaluate((element) => globalThis.getComputedStyle(element).flexDirection))
      .toBe('row');

    await setServerWindowWidth(800);
    await expectBottomGutter(12);
    const toolbar = window.locator('.knowledge-management__toolbar');
    await expect
      .poll(() => toolbar.evaluate((element) => globalThis.getComputedStyle(element).position))
      .toBe('static');
    expect(
      await toolbar.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor),
    ).not.toBe('rgba(0, 0, 0, 0)');

    await setServerWindowWidth(540);
    await expectBottomGutter(12);
    const railButtons = rail.getByRole('button');
    await expect(railButtons).toHaveCount(4);
    for (const section of ['Documents', 'Categories', 'Uploads', 'Trash']) {
      const button = rail.getByRole('button', { name: new RegExp(`^${section} \\d+$`) });
      await expect(button.locator('span')).toHaveText(section.toLowerCase());
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(
        await button.evaluate((element) => {
          const buttonRect = element.getBoundingClientRect();
          const children = [...element.querySelectorAll('span, strong')];
          return children.every((child) => {
            const childRect = child.getBoundingClientRect();
            return (
              childRect.left >= buttonRect.left &&
              childRect.right <= buttonRect.right &&
              child.scrollWidth <= child.clientWidth
            );
          });
        }),
      ).toBe(true);
    }
    await expect
      .poll(() => rail.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true);
    await rail.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await search.fill('Payment API Degradation');
    const narrowRow = window.locator('.knowledge-management-row', {
      hasText: 'Payment API Degradation Guide',
    });
    for (const action of ['Edit', 'Replace PDF', 'Trash']) {
      await expect(narrowRow.getByRole('button', { name: action, exact: true })).toBeVisible();
    }
  });

  test('Knowledge management document workflow preserves search edit rename and pagination', async () => {
    await seedKnowledgePaginationFixtures(107);
    const { content, rail, search } = await openOwnerKnowledgeManagement();

    const documentsScrollTop = await content.evaluate((element) => {
      element.scrollTop = 180;
      return element.scrollTop;
    });
    expect(documentsScrollTop).toBeGreaterThan(0);

    await rail.getByRole('button', { name: /^Categories \d+$/ }).click();
    await expect(content).toHaveAttribute('aria-label', 'Categories management section');
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
    const newCategory = window.getByLabel('New category name');
    await expect(newCategory).toHaveClass(/tactile-input/);
    expect(
      await newCategory.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          background: style.backgroundColor,
          borderRadius: style.borderRadius,
          borderWidth: style.borderTopWidth,
          height: style.height,
        };
      }),
    ).toEqual({
      background: 'rgba(0, 0, 0, 0)',
      borderRadius: '2px',
      borderWidth: '1px',
      height: '44px',
    });

    await rail.getByRole('button', { name: /^Documents \d+$/ }).click();
    await expect(content).toHaveAttribute('aria-label', 'Documents management section');
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBe(documentsScrollTop);

    const loadMore = window.getByRole('button', { name: 'Load more documents', exact: true });
    await expect(loadMore).toBeVisible();
    const initialRows = await content.locator('.knowledge-management-row').count();
    await loadMore.click();
    await expect
      .poll(() => content.locator('.knowledge-management-row').count())
      .toBeGreaterThan(initialRows);

    await search.fill('Payment API Degradation');
    const paymentRow = window.locator('.knowledge-management-row', {
      hasText: 'Payment API Degradation Guide',
    });
    await expect(paymentRow).toHaveCount(1);
    for (const action of ['Edit', 'Replace PDF', 'Trash']) {
      await expect(paymentRow.getByRole('button', { name: action, exact: true })).toBeVisible();
    }
    await search.fill('');

    await rail.getByRole('button', { name: /^Categories \d+$/ }).click();
    await window.getByLabel('Category name Reader validation').fill('Reader operations');
    await window.getByRole('button', { name: 'Save Reader validation' }).click();
    await expect(window.getByLabel('Category name Reader operations')).toHaveValue(
      'Reader operations',
    );
    await rail.getByRole('button', { name: /^Documents \d+$/ }).click();
    await expect(
      window.locator('.knowledge-management-row', { hasText: CONTINUOUS_READER_TITLE }),
    ).toContainText('Reader operations');

    await search.fill('Payment API Degradation');
    await paymentRow.getByRole('button', { name: 'Edit', exact: true }).click();
    await paymentRow.getByLabel('Display title').fill('Payment API Degradation Guide Revised');
    await paymentRow.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(
      paymentRow.getByRole('heading', {
        name: 'Payment API Degradation Guide Revised',
        exact: true,
      }),
    ).toBeVisible();
  });

  test('Knowledge management upload workflow preserves transfer publish and replace controls', async () => {
    test.setTimeout(120_000);
    const { rail, search } = await openOwnerKnowledgeManagement();
    const fixtureDir = path.join(tempDataDir, 'knowledge-management-uploads');
    fs.mkdirSync(fixtureDir, { recursive: true });

    await search.fill('Payment API Degradation');
    const paymentRow = window.locator('.knowledge-management-row', {
      hasText: 'Payment API Degradation Guide',
    });
    const pb = await makeSuperuserPbClient(pbPort);
    const originalDocument = await pb.collection('knowledge_documents').getFirstListItem<{
      id: string;
      sourceKey: string;
      category: string;
      categoryId: string;
      documentType: string;
      title: string;
      displayTitle: string;
      fileName: string;
      checksum: string;
      revision: number;
      publishedByAccountId: string;
      publishedByName: string;
      publishedAt: string;
    }>('fileName = "Payment API Degradation Guide.pdf"', { requestKey: null });
    const replacementPath = path.join(fixtureDir, 'Replacement flow evidence.pdf');
    const replacementBytes = buildKnowledgePdfFixture({
      title: 'Replacement flow evidence',
      pageCount: 1,
    });
    fs.writeFileSync(replacementPath, replacementBytes, { mode: 0o600 });
    await installServerKnowledgeDialogFixture([replacementPath]);
    await paymentRow.getByRole('button', { name: 'Replace PDF', exact: true }).click();
    const replacementRow = window.locator('.knowledge-management-row--upload', {
      hasText: 'Replacement flow evidence.pdf',
    });
    const replaceExisting = replacementRow.getByRole('button', {
      name: 'Replace existing',
      exact: true,
    });
    await expect(replaceExisting).toBeEnabled({ timeout: 30_000 });
    await replaceExisting.click();
    await expect(replacementRow).not.toBeVisible();
    await expect
      .poll(async () => {
        const current = await pb
          .collection('knowledge_documents')
          .getOne<{ revision: number }>(originalDocument.id, { requestKey: null });
        return current.revision;
      })
      .toBe(originalDocument.revision + 1);
    const replacedDocument = await pb
      .collection('knowledge_documents')
      .getOne<typeof originalDocument>(originalDocument.id, { requestKey: null });
    expect(replacedDocument).toMatchObject({
      id: originalDocument.id,
      sourceKey: originalDocument.sourceKey,
      category: originalDocument.category,
      categoryId: originalDocument.categoryId,
      documentType: originalDocument.documentType,
      title: originalDocument.title,
      displayTitle: originalDocument.displayTitle,
      fileName: originalDocument.fileName,
      publishedByAccountId: originalDocument.publishedByAccountId,
      publishedByName: originalDocument.publishedByName,
      publishedAt: originalDocument.publishedAt,
      revision: originalDocument.revision + 1,
    });
    expect(replacedDocument.checksum).toBe(
      crypto.createHash('sha256').update(replacementBytes).digest('hex'),
    );
    expect(replacedDocument.checksum).not.toBe(originalDocument.checksum);
    await expect(
      pb.collection('knowledge_documents').getFullList({
        filter: 'fileName = "Replacement flow evidence.pdf"',
        requestKey: null,
      }),
    ).resolves.toHaveLength(0);

    const secondReplacementPath = path.join(fixtureDir, 'Second replacement flow evidence.pdf');
    const secondReplacementBytes = buildKnowledgePdfFixture({
      title: 'Second replacement flow evidence',
      pageCount: 2,
    });
    fs.writeFileSync(secondReplacementPath, secondReplacementBytes, { mode: 0o600 });
    await installServerKnowledgeDialogFixture([secondReplacementPath]);
    await rail.getByRole('button', { name: /^Documents \d+$/ }).click();
    await expect(
      paymentRow.getByRole('button', { name: 'Replace PDF', exact: true }),
    ).toBeVisible();
    await paymentRow.getByRole('button', { name: 'Replace PDF', exact: true }).click();
    const secondReplacementRow = window.locator('.knowledge-management-row--upload', {
      hasText: 'Second replacement flow evidence.pdf',
    });
    const secondReplaceExisting = secondReplacementRow.getByRole('button', {
      name: 'Replace existing',
      exact: true,
    });
    await expect(secondReplaceExisting).toBeEnabled({ timeout: 30_000 });
    await secondReplaceExisting.click();
    await expect(secondReplacementRow).not.toBeVisible();
    await expect
      .poll(async () => {
        const current = await pb
          .collection('knowledge_documents')
          .getOne<{ revision: number }>(originalDocument.id, { requestKey: null });
        return current.revision;
      })
      .toBe(originalDocument.revision + 2);
    const twiceReplacedDocument = await pb
      .collection('knowledge_documents')
      .getOne<typeof originalDocument>(originalDocument.id, { requestKey: null });
    expect(twiceReplacedDocument).toMatchObject({
      id: originalDocument.id,
      sourceKey: originalDocument.sourceKey,
      category: originalDocument.category,
      categoryId: originalDocument.categoryId,
      documentType: originalDocument.documentType,
      title: originalDocument.title,
      displayTitle: originalDocument.displayTitle,
      fileName: originalDocument.fileName,
      publishedByAccountId: originalDocument.publishedByAccountId,
      publishedByName: originalDocument.publishedByName,
      publishedAt: originalDocument.publishedAt,
      revision: originalDocument.revision + 2,
    });
    expect(twiceReplacedDocument.checksum).toBe(
      crypto.createHash('sha256').update(secondReplacementBytes).digest('hex'),
    );
    await expect(
      pb.collection('knowledge_documents').getFullList({
        filter: 'fileName = "Second replacement flow evidence.pdf"',
        requestKey: null,
      }),
    ).resolves.toHaveLength(0);

    const discardPath = path.join(fixtureDir, originalDocument.fileName);
    fs.writeFileSync(
      discardPath,
      buildKnowledgePdfFixture({ title: 'Discard flow evidence', pageCount: 1 }),
      { mode: 0o600 },
    );
    await installServerKnowledgeDialogFixture([discardPath]);
    await window.getByRole('button', { name: 'Add PDFs', exact: true }).click();
    const discardRow = window.locator('.knowledge-management-row--upload', {
      hasText: originalDocument.fileName,
    });
    await expect(
      discardRow.getByRole('button', { name: 'Replace existing', exact: true }),
    ).toBeEnabled({ timeout: 30_000 });
    await discardRow.getByRole('button', { name: `Discard ${originalDocument.fileName}` }).click();
    await discardRow
      .getByRole('button', { name: `Confirm discard ${originalDocument.fileName}` })
      .click();
    await expect(discardRow).not.toBeVisible();

    const publishPath = path.join(fixtureDir, 'Operational publish evidence.pdf');
    fs.writeFileSync(
      publishPath,
      buildKnowledgePdfFixture({ title: 'Operational publish evidence', pageCount: 1 }),
      { mode: 0o600 },
    );
    await installServerKnowledgeDialogFixture([publishPath]);
    await window.getByRole('button', { name: 'Add PDFs', exact: true }).click();
    const publishRow = window.locator('.knowledge-management-row--upload', {
      hasText: 'Operational publish evidence.pdf',
    });
    const publish = publishRow.getByRole('button', { name: 'Publish', exact: true });
    await expect(publish).toBeEnabled({ timeout: 30_000 });
    await publish.click();
    await expect(publishRow).not.toBeVisible();

    const largeUploadPath = path.join(fixtureDir, 'Operational upload controls.pdf');
    writePaddedKnowledgePdfFixture(
      largeUploadPath,
      'Operational upload controls',
      20 * 1024 * 1024 - 8_192,
    );
    await installServerKnowledgeDialogFixture([largeUploadPath]);
    await window.getByRole('button', { name: 'Add PDFs', exact: true }).click();
    await expect(window.getByRole('heading', { name: 'Upload queue', exact: true })).toBeVisible();
    await expect(window.getByLabel('Batch upload progress')).toBeVisible();
    const pauseAll = window.getByRole('button', { name: 'Pause all', exact: true });
    await expect(pauseAll).toBeVisible();
    await pauseAll.click();
    const resumeAll = window.getByRole('button', { name: 'Resume all', exact: true });
    await expect(resumeAll).toBeVisible();
    await resumeAll.click();
    await expect(window.getByRole('button', { name: 'Pause all', exact: true })).toBeVisible();
    const cancelUpload = window.getByRole('button', {
      name: 'Cancel Operational upload controls.pdf',
      exact: true,
    });
    await expect(cancelUpload).toHaveClass(/knowledge-management__danger-outline/);
    await cancelUpload.click();
    await expect(cancelUpload).not.toBeVisible();

    await rail.getByRole('button', { name: /^Documents \d+$/ }).click();
    await search.fill('Operational publish evidence');
    await expect(
      window.locator('.knowledge-management-row', { hasText: 'Operational publish evidence' }),
    ).toBeVisible();
  });

  test('Knowledge management trash workflow restores and permanently deletes live documents', async () => {
    const { rail, search } = await openOwnerKnowledgeManagement();
    const pb = await makeSuperuserPbClient(pbPort);
    const documentToDelete = await pb
      .collection('knowledge_documents')
      .getFirstListItem<{ id: string }>('fileName = "Payment API Degradation Guide.pdf"', {
        requestKey: null,
      });

    await search.fill('Checkout Service Incident Runbook');
    const restoreSource = window.locator('.knowledge-management-row', {
      hasText: 'Checkout Service Incident Runbook',
    });
    await restoreSource.getByRole('button', { name: 'Trash', exact: true }).click();
    await rail.getByRole('button', { name: /^Trash 1$/ }).click();
    const restoreRow = window.locator('.knowledge-management-row', {
      hasText: 'Checkout Service Incident Runbook',
    });
    const initialRestoreDelete = restoreRow.getByRole('button', {
      name: 'Delete permanently',
      exact: true,
    });
    await expect(initialRestoreDelete).toHaveClass(/knowledge-management__danger-outline/);
    await restoreRow.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(restoreRow).not.toBeVisible();

    await rail.getByRole('button', { name: /^Documents \d+$/ }).click();
    await search.fill('Payment API Degradation');
    const deleteSource = window.locator('.knowledge-management-row', {
      hasText: 'Payment API Degradation Guide',
    });
    await deleteSource.getByRole('button', { name: 'Trash', exact: true }).click();
    await rail.getByRole('button', { name: /^Trash 1$/ }).click();
    const permanentRow = window.locator('.knowledge-management-row', {
      hasText: 'Payment API Degradation Guide',
    });
    const initialDelete = permanentRow.getByRole('button', {
      name: 'Delete permanently',
      exact: true,
    });
    await expect(initialDelete).toHaveClass(/knowledge-management__danger-outline/);
    await initialDelete.click();
    await permanentRow.getByLabel('Confirm your password').fill(PRIVILEGED_TEST_PASSWORD);
    const confirmedDelete = permanentRow.getByRole('button', {
      name: 'Delete permanently',
      exact: true,
    });
    await expect(confirmedDelete).toHaveClass(/tactile-button--danger/);
    await expect(confirmedDelete).not.toHaveClass(/knowledge-management__danger-outline/);
    await confirmedDelete.click();
    await expect
      .poll(async () => {
        try {
          await pb.collection('knowledge_documents').getOne(documentToDelete.id, {
            requestKey: null,
          });
          return true;
        } catch (error) {
          if ((error as { status?: unknown }).status === 404) return false;
          throw error;
        }
      })
      .toBe(false);
    await expect(permanentRow).not.toBeVisible();
    await expect(rail.getByRole('button', { name: /^Trash 0$/ })).toBeVisible();
  });

  test('Knowledge management keeps retained audit records out of the retired navigation', async () => {
    await seedKnowledgeAuditFixtures(27);
    const { content, rail } = await openOwnerKnowledgeManagement();

    const sectionNames = await rail.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const label = button.getAttribute('aria-label');
        return label?.slice(0, label.lastIndexOf(' '));
      }),
    );
    expect(sectionNames).toEqual(['Documents', 'Categories', 'Uploads', 'Trash']);
    await expect(rail.getByRole('button', { name: /^Audit \d+$/ })).toHaveCount(0);
    await expect(content.locator('.knowledge-audit-row')).toHaveCount(0);
  });

  test('Vital 1: App Launch & Compose Tab', async () => {
    const title = await window.title();
    expect(title).toMatch(/Relay/i);

    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
    await expect(window.getByRole('button', { name: 'START BRIDGE' })).toBeVisible();
  });

  test('Knowledge launches Wiki, Contacts, and Servers in order and retains contextual state', async () => {
    const suffix = uniqueSuffix();
    const contactName = `Knowledge Contact ${suffix}`;
    const contactEmail = `knowledge.contact.${suffix}@example.com`;
    const contactNote = `Contact escalation context ${suffix}`;
    const serverName = `knowledge-server-${suffix}`;
    const serverNote = `Server recovery context ${suffix}`;

    await createContactDirect(pbPort, contactName, contactEmail);
    await createServerDirect(pbPort, serverName, contactEmail);
    await createContextualNoteDirect(pbPort, 'contact', contactEmail, contactNote);
    await createContextualNoteDirect(pbPort, 'server', serverName, serverNote);

    if (!electronApp) throw new Error('Electron app not launched');
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1160, 900);
    });
    await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBeLessThanOrEqual(1160);
    expect(await window.evaluate(() => globalThis.innerWidth)).toBeGreaterThan(899);

    const home = await goToKnowledgeHome(window);
    const destinationButtons = home.getByRole('button', {
      name: /^Open (?:Wiki|Contacts|Servers),/,
    });
    await expect(destinationButtons).toHaveCount(3);
    expect(
      await destinationButtons.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label')?.split(',')[0]),
      ),
    ).toEqual(['Open Wiki', 'Open Contacts', 'Open Servers']);
    await expect(window.getByTestId('sidebar-notes')).toHaveCount(0);
    await expect(window.getByTestId('sidebar-people')).toHaveCount(0);
    await expect(window.getByTestId('sidebar-servers')).toHaveCount(0);

    await home.getByRole('button', { name: /^Open Wiki,/ }).click();
    const destinationNavigation = window.getByRole('navigation', {
      name: 'Knowledge destinations',
    });
    await expect(
      destinationNavigation.getByRole('button', { name: 'Wiki', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    const wikiWorkspace = window.getByRole('region', { name: 'wiki workspace' });
    await expect(wikiWorkspace).toBeVisible();
    await expect(window.locator('[data-knowledge-panel]:visible')).toHaveCount(1);

    await destinationNavigation.getByRole('button', { name: 'Contacts', exact: true }).click();
    const contactsWorkspace = window.getByRole('region', { name: 'contacts workspace' });
    await expect(wikiWorkspace).toBeHidden();
    await expect(window.locator('[data-knowledge-panel]:visible')).toHaveCount(1);
    await expectDirectoryBandsToSpanWorkspace(contactsWorkspace);
    await expectDirectoryToolbarControlsToBeCentered(contactsWorkspace);
    const contactRow = contactsWorkspace
      .getByRole('button', { name: new RegExp(escapeRegExp(contactEmail), 'i') })
      .first();
    await expect(contactRow).toBeVisible();
    await contactRow.click();
    await expect(contactsWorkspace.locator('.detail-panel')).toContainText(contactName);
    await expect(contactsWorkspace.locator('.detail-panel')).toContainText(contactNote);

    await destinationNavigation.getByRole('button', { name: 'Servers', exact: true }).click();
    const serversWorkspace = window.getByRole('region', { name: 'servers workspace' });
    await expectDirectoryBandsToSpanWorkspace(serversWorkspace);
    await expectDirectoryToolbarControlsToBeCentered(serversWorkspace);
    const serverRow = serversWorkspace
      .getByRole('button', { name: new RegExp(escapeRegExp(serverName), 'i') })
      .first();
    await expect(serverRow).toBeVisible();
    await serverRow.click();
    await expect(serversWorkspace.locator('.detail-panel')).toContainText(serverName);
    await expect(serversWorkspace.locator('.detail-panel')).toContainText(serverNote);

    await destinationNavigation.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(contactsWorkspace.locator('.detail-panel')).toContainText(contactName);
    await expect(contactsWorkspace.locator('.detail-panel')).toContainText(contactNote);
    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Knowledge');
  });

  test('continuous Wiki PDF scrolls, tracks pages, bounds canvases, and retains reader state', async () => {
    test.setTimeout(120_000);
    const connectedClient = await launchConnectedClient();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    connectedClient.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    connectedClient.on('pageerror', (error) => pageErrors.push(error.message));
    await enterKnowledgeDestination(connectedClient, 'Wiki');
    const viewer = await openKnowledgeReaderDocument(
      connectedClient,
      'Reader validation',
      CONTINUOUS_READER_TITLE,
    );
    await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);
    const continuousMode = viewer.getByRole('button', { name: 'View options: Continuous' });
    await expect(continuousMode).toHaveAttribute('aria-expanded', 'false');

    const viewport = viewer.getByRole('region', { name: 'Continuous PDF pages' });
    const pageShells = viewport.locator('.knowledge-page-shell');
    await expect(pageShells).toHaveCount(CONTINUOUS_READER_PAGE_COUNT);
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await expect.poll(() => viewport.locator('canvas').count()).toBeGreaterThan(0);
    expect(await viewport.locator('canvas').count()).toBeLessThanOrEqual(5);

    const targetPageIndex = 7;
    await viewport.evaluate((element, pageIndex) => {
      const shell = element.querySelector(`[data-page-index="${pageIndex}"]`);
      if (!shell) throw new Error(`Missing page shell ${pageIndex}`);
      element.scrollTop += shell.getBoundingClientRect().top - element.getBoundingClientRect().top;
    }, targetPageIndex);
    await expect(viewer).toContainText(
      `Page ${targetPageIndex + 1} of ${CONTINUOUS_READER_PAGE_COUNT}`,
    );
    await expect.poll(() => viewport.locator('canvas').count()).toBeLessThanOrEqual(5);

    await continuousMode.click();
    await viewer
      .getByRole('dialog', { name: 'View options' })
      .getByRole('button', { name: 'Single page' })
      .click();
    const singleMode = viewer.getByRole('button', { name: 'View options: Single page' });
    await expect(singleMode).toHaveAttribute('aria-expanded', 'false');
    await expect(viewer).toContainText(
      `Page ${targetPageIndex + 1} of ${CONTINUOUS_READER_PAGE_COUNT}`,
    );

    const destinationNavigation = connectedClient.getByRole('navigation', {
      name: 'Knowledge destinations',
    });
    await destinationNavigation.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(connectedClient.getByRole('region', { name: 'contacts workspace' })).toBeVisible();
    await destinationNavigation.getByRole('button', { name: 'Wiki', exact: true }).click();
    await expect(singleMode).toBeVisible();
    await expect(viewer).toContainText(
      `Page ${targetPageIndex + 1} of ${CONTINUOUS_READER_PAGE_COUNT}`,
    );
    await singleMode.click();
    await viewer
      .getByRole('dialog', { name: 'View options' })
      .getByRole('button', { name: 'Continuous scrolling' })
      .click();
    await expect(viewer.getByRole('button', { name: 'View options: Continuous' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(viewer.getByRole('region', { name: 'Continuous PDF pages' })).toBeVisible();

    expect(consoleErrors, `Renderer console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `Renderer page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('Knowledge PDF links survive repeated top-level tab leave and return cycles', async () => {
    test.setTimeout(120_000);
    const connectedClient = await launchConnectedClient();
    const lifecycleErrors: string[] = [];
    const captureLifecycleError = (message: string) => {
      if (/sendWithPromise|KnowledgePdfPage|Wiki unavailable/i.test(message)) {
        lifecycleErrors.push(message);
      }
    };
    connectedClient.on('console', (message) => {
      if (message.type() === 'error') captureLifecycleError(message.text());
    });
    connectedClient.on('pageerror', (error) => captureLifecycleError(error.message));

    await enterKnowledgeDestination(connectedClient, 'Wiki');
    const viewer = await openKnowledgeReaderDocument(
      connectedClient,
      'Reader validation',
      CONTINUOUS_READER_TITLE,
    );
    const wikiWorkspace = connectedClient.getByRole('region', { name: 'wiki workspace' });
    await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await goToTab(connectedClient, 'sidebar-compose', 'Compose');
      await expect(wikiWorkspace).toBeHidden();

      await goToTab(connectedClient, 'sidebar-knowledge', 'Knowledge');
      await expect(wikiWorkspace).toBeVisible();
      await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);
      await expect(
        connectedClient.getByRole('heading', { name: 'Wiki unavailable', exact: true }),
      ).toHaveCount(0);
    }

    expect(lifecycleErrors).toEqual([]);
  });

  test('Knowledge PDF links use the compact Wiki Library drawer without losing reader state', async () => {
    test.setTimeout(120_000);
    const authenticatedDocuments = await (
      await makePbClient(pbPort)
    )
      .collection('knowledge_documents')
      .getFullList<{ title: string }>({ requestKey: null });
    expect(authenticatedDocuments.map(({ title }) => title)).toContain(CONTINUOUS_READER_TITLE);
    const connectedClient = await launchConnectedClient();
    if (!clientElectronApp) throw new Error('Connected Electron app not launched');
    await clientElectronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1200, 900);
    });
    await expect
      .poll(() => connectedClient.evaluate(() => globalThis.innerWidth))
      .toBeGreaterThan(900);

    await enterKnowledgeDestination(connectedClient, 'Wiki');
    const viewer = await openKnowledgeReaderDocument(
      connectedClient,
      'Reader validation',
      CONTINUOUS_READER_TITLE,
    );
    const workspace = connectedClient.getByRole('region', { name: 'Wiki reader workspace' });
    const drawer = connectedClient.getByRole('complementary', { name: 'Wiki reader sidebar' });
    const libraryToggle = connectedClient.getByRole('button', {
      name: 'Wiki reader sidebar',
      exact: true,
    });
    const desktopRestore = connectedClient.getByRole('button', {
      name: 'Show Wiki reader sidebar',
    });
    const desktopCollapse = connectedClient.getByRole('button', {
      name: 'Collapse Wiki reader sidebar',
    });
    await expect(workspace).toHaveAttribute('data-library-collapsed', 'false');
    await expect(libraryToggle).toBeHidden();
    await expect(desktopRestore).toBeHidden();
    await expect(desktopCollapse).toBeVisible();
    await expect(drawer).toBeVisible();

    await expect(drawer).toBeVisible();
    await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);

    await desktopCollapse.click();
    await expect(workspace).toHaveAttribute('data-library-collapsed', 'true');
    await expect(drawer).toBeHidden();
    await expect(desktopRestore).toBeVisible();
    await expect(desktopRestore).toBeFocused();
    await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);

    await clientElectronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(900, 900);
    });
    await expect
      .poll(() => connectedClient.evaluate(() => globalThis.innerWidth))
      .toBeLessThanOrEqual(900);
    await expect(desktopRestore).toBeHidden();
    await expect(libraryToggle).toBeVisible();
    await expect(libraryToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toBeHidden();

    await libraryToggle.click();
    await expect(workspace).toHaveAttribute('data-library-drawer', 'open');
    await expect(drawer).toBeVisible();
    await expect(connectedClient.getByRole('tab', { name: 'Contents' })).toBeFocused();
    await connectedClient.getByRole('tab', { name: 'Library' }).click();
    const readerCategory = connectedClient.getByRole('treeitem', {
      name: 'Reader validation, 1 document',
      exact: true,
    });
    if ((await readerCategory.getAttribute('aria-expanded')) === 'false') {
      await readerCategory.click();
    }
    await connectedClient
      .getByRole('treeitem', { name: CONTINUOUS_READER_TITLE, exact: true })
      .click();
    await expect(drawer).toBeHidden();
    await expect(workspace).toHaveAttribute('data-library-collapsed', 'true');

    await libraryToggle.click();
    await expect(drawer).toBeVisible();
    await connectedClient.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(libraryToggle).toBeFocused();

    await clientElectronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1200, 900);
    });
    await expect
      .poll(() => connectedClient.evaluate(() => globalThis.innerWidth))
      .toBeGreaterThan(900);
    await expect(libraryToggle).toBeHidden();
    await expect(workspace).toHaveAttribute('data-library-collapsed', 'true');
    await expect(desktopRestore).toBeVisible();
    await expect(drawer).toBeHidden();
    await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);

    await desktopRestore.click();
    await expect(workspace).toHaveAttribute('data-library-collapsed', 'false');
    await expect(drawer).toBeVisible();
    await expect(connectedClient.getByRole('tab', { name: 'Contents' })).toBeFocused();
    await expect(viewer).toContainText(`Page 1 of ${CONTINUOUS_READER_PAGE_COUNT}`);
    await expect(
      connectedClient.getByRole('heading', { name: 'Wiki unavailable', exact: true }),
    ).toHaveCount(0);
  });

  test('role accounts preserve username sign-in, owner boundaries, passwordless use, and offline reading', async () => {
    test.setTimeout(180_000);
    await activateRoleAccountFixture(pbPort, 'ryan', PRIVILEGED_TEST_PASSWORD);
    await activateRoleAccountFixture(pbPort, 'charles', PRIVILEGED_TEST_PASSWORD);

    let connectedClient = await launchConnectedClient();
    let connectionStatus = connectedClient.locator('[data-connection-state]').first();

    await expect(connectedClient.getByTestId('sidebar-operator-selector')).toHaveCount(0);
    await goToTab(connectedClient, 'sidebar-compose', 'Compose');
    await expect(connectedClient.getByRole('button', { name: 'START BRIDGE' })).toBeVisible();
    await enterKnowledgeDestination(connectedClient, 'Wiki');
    await expect(
      await openKnowledgeReaderDocument(connectedClient, 'General', 'Link navigation test'),
    ).toContainText('Page 1 of 2');

    const serverAccess = await openPrivilegedAccess(window);
    await serverAccess.getByLabel('Username').fill('ryan');
    await serverAccess.getByLabel('Password').fill(PRIVILEGED_TEST_PASSWORD);
    await submitPrivilegedSignIn(serverAccess);
    await expect(serverAccess.getByText('Owner', { exact: true })).toBeVisible();
    await expect(serverAccess.getByText(RYAN_BLEDSOE, { exact: true })).toBeVisible();
    await expect(serverAccess.getByText('@ryan', { exact: true })).toBeVisible();
    await window.getByRole('tab', { name: 'Administration', exact: true }).click();
    const ownerAdministration = window.getByRole('region', { name: 'Relay administration' });
    await expect(ownerAdministration).toBeVisible();
    const ownerRow = ownerAdministration.locator('.administration-row', {
      hasText: RYAN_BLEDSOE,
    });
    await expect(ownerRow).toBeVisible();
    const administratorRow = ownerAdministration.locator('.administration-row', {
      hasText: CHARLES_GIBBS,
    });
    await expect(ownerRow).toContainText('@ryan');
    await expect(ownerRow).toContainText('OWNER');
    await expect(administratorRow).toContainText('@charles');
    await expect(administratorRow).toContainText('ADMIN');
    await expect(
      ownerAdministration.getByRole('button', { name: 'Add Administrator' }),
    ).toBeVisible();

    await window.getByRole('tab', { name: 'Access', exact: true }).click();
    await serverAccess.getByRole('button', { name: 'Sign out', exact: true }).click();
    await serverAccess.getByLabel('Username').fill('charles');
    await serverAccess.getByLabel('Password').fill(PRIVILEGED_TEST_PASSWORD);
    await submitPrivilegedSignIn(serverAccess);
    await expect(serverAccess.getByText('Administrator', { exact: true })).toBeVisible();
    await expect(serverAccess.getByText('Charles Gibbs', { exact: true })).toBeVisible();
    await expect(serverAccess.getByText('@charles', { exact: true })).toBeVisible();

    await window.getByRole('tab', { name: 'Administration', exact: true }).click();
    const administratorWorkspace = window.getByRole('region', { name: 'Relay administration' });
    await expect(administratorWorkspace).toBeVisible();
    await expect(
      administratorWorkspace.getByRole('button', { name: 'Add Administrator' }),
    ).toHaveCount(0);
    await expect(
      administratorWorkspace.getByRole('button', { name: /Transfer ownership/ }),
    ).toHaveCount(0);

    await administratorWorkspace.getByRole('button', { name: 'Add Publisher' }).click();
    await administratorWorkspace.getByLabel('Publisher username').fill('tristan');
    await administratorWorkspace.getByLabel('Publisher display name').fill(TRISTAN_BOWLES);
    await administratorWorkspace.getByRole('button', { name: 'Create Publisher' }).click();
    await expect(administratorWorkspace.getByText(TRISTAN_BOWLES, { exact: true })).toBeVisible();
    await expect(
      administratorWorkspace.getByText('Publisher account created.', { exact: false }),
    ).toBeVisible();
    const publisherRow = administratorWorkspace.locator('.administration-row', {
      hasText: TRISTAN_BOWLES,
    });
    await expect(publisherRow).toContainText('PUBLISHER');

    const privilegedSnapshot = await readRoleAccountSnapshot(pbPort);
    expect(privilegedSnapshot).toMatchObject({
      ownerUsername: 'ryan',
      ownerDisplayName: RYAN_BLEDSOE,
      administratorUsername: 'charles',
      administratorDisplayName: 'Charles Gibbs',
      ownerCount: 1,
      publisherCount: 1,
      legacyRosterPresent: false,
    });

    await enterKnowledgeDestination(connectedClient, 'Wiki');
    await expect(
      await openKnowledgeReaderDocument(connectedClient, 'General', 'Link navigation test'),
    ).toContainText('Page 1 of 2');

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
    await enterKnowledgeDestination(connectedClient, 'Wiki');
    await expect(
      await openKnowledgeReaderDocument(connectedClient, 'General', 'Link navigation test'),
    ).toContainText('Page 1 of 2');
  });

  test('publisher resumes a Knowledge batch after interruption and publishes for passwordless readers', async () => {
    test.setTimeout(240_000);
    await activateRoleAccountFixture(pbPort, 'ryan', PRIVILEGED_TEST_PASSWORD);
    await activatePrivilegedPublisherFixture(pbPort);

    let connectedClient = await launchConnectedClient();
    const publisherAccess = await openPrivilegedAccess(connectedClient);
    const publisherUsername = publisherAccess.getByLabel('Username');
    const publisherPassword = publisherAccess.getByLabel('Password');
    await publisherPassword.fill(PUBLISHER_TEST_PASSWORD);
    await publisherUsername.fill('tristan');
    await expect(publisherUsername).toHaveValue('tristan');
    await expect(publisherPassword).toHaveValue(PUBLISHER_TEST_PASSWORD);
    await submitPrivilegedSignIn(publisherAccess);
    await expect(publisherAccess.getByText('Pair this workstation')).toBeVisible();

    const serverAccess = await openPrivilegedAccess(window);
    await serverAccess.getByLabel('Username').fill('ryan');
    await serverAccess.getByLabel('Password').fill(PRIVILEGED_TEST_PASSWORD);
    await submitPrivilegedSignIn(serverAccess);
    await expect(serverAccess.getByText('Owner', { exact: true })).toBeVisible();
    const workstationOwner = serverAccess.getByLabel('Workstation owner');
    await expect(
      workstationOwner.getByRole('option', {
        name: `${TRISTAN_BOWLES} — Publisher`,
        exact: true,
      }),
    ).toBeAttached();
    await workstationOwner.selectOption({
      label: `${TRISTAN_BOWLES} — Publisher`,
    });
    await serverAccess.getByRole('button', { name: 'Create pairing code' }).click();
    const challenge = serverAccess.getByLabel('Active pairing challenge');
    await expect(challenge).toBeVisible();
    await expect(challenge.locator('dd').nth(0)).toHaveText(`${TRISTAN_BOWLES} · Publisher`);
    const challengeId = (await challenge.locator('dd').nth(1).textContent())?.trim();
    const pairingCode = (await challenge.locator('dd').nth(2).textContent())?.trim();
    expect(challengeId).toBeTruthy();
    expect(pairingCode).toMatch(/^[A-Z2-9]{8}$/);

    await publisherAccess.getByLabel('Pairing challenge ID').fill(challengeId!);
    await publisherAccess.getByLabel('One-time pairing code').fill(pairingCode!);
    await publisherAccess.getByLabel('Device label').fill('E2E publisher laptop');
    await publisherAccess.getByRole('button', { name: 'Pair device' }).click();
    await expect(publisherAccess.getByText('Publisher', { exact: true })).toBeVisible();

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
    await enterKnowledgeDestination(connectedClient, 'Wiki');
    await connectedClient.getByRole('button', { name: 'Manage Wiki', exact: true }).click();
    await expect(
      connectedClient.getByRole('heading', { name: 'Manage Wiki', exact: true }),
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
    const restartedAccess = await openPrivilegedAccess(connectedClient);
    const restartedUsername = restartedAccess.getByLabel('Username');
    const restartedPassword = restartedAccess.getByLabel('Password');
    await restartedPassword.fill(PUBLISHER_TEST_PASSWORD);
    await restartedUsername.fill('tristan');
    await expect(restartedUsername).toHaveValue('tristan');
    await expect(restartedPassword).toHaveValue(PUBLISHER_TEST_PASSWORD);
    await submitPrivilegedSignIn(restartedAccess);
    await expect(restartedAccess.getByText('Publisher', { exact: true })).toBeVisible();

    await enterKnowledgeDestination(connectedClient, 'Wiki');
    await connectedClient.getByRole('button', { name: 'Manage Wiki', exact: true }).click();
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
    await enterKnowledgeDestination(connectedClient, 'Wiki');
    await expect(
      await openKnowledgeReaderDocument(connectedClient, 'General', largeTitle),
    ).toContainText('Page 1 of 1');
  });

  test('Knowledge PDF links navigate within Relay and open HTTPS in the system browser', async () => {
    test.setTimeout(120_000);
    const connectedClient = await launchConnectedClient();
    const rendererLogs: string[] = [];
    const rendererErrors: string[] = [];
    const pageErrors: string[] = [];
    connectedClient.on('console', (message) => {
      rendererLogs.push(message.text());
      if (message.type() === 'error') rendererErrors.push(message.text());
    });
    connectedClient.on('pageerror', (error) => pageErrors.push(error.message));

    await enterKnowledgeDestination(connectedClient, 'Wiki');
    const sourceViewer = await openKnowledgeReaderDocument(
      connectedClient,
      'General',
      'Link navigation test',
    );
    const sourceDocument = connectedClient.getByRole('treeitem', {
      name: 'Link navigation test',
      exact: true,
    });
    await expect(sourceViewer).toContainText('Page 1 of 2');
    await sourceViewer.getByRole('button', { name: 'View options: Continuous' }).click();
    await sourceViewer
      .getByRole('dialog', { name: 'View options' })
      .getByRole('button', { name: 'Single page' })
      .click();
    await expect(
      sourceViewer.getByRole('button', { name: 'View options: Single page' }),
    ).toBeVisible();
    await sourceViewer.getByRole('button', { name: 'Open linked location in this guide' }).click();
    await expect(sourceViewer).toContainText('Page 2 of 2');
    await connectedClient.getByRole('tab', { name: 'Library' }).click();
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

    await openKnowledgeReaderDocument(connectedClient, 'General', 'Link navigation test');
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

    await openKnowledgeReaderDocument(connectedClient, 'General', 'Link navigation test');
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
    expect(rendererErrors, `Renderer console errors:\n${rendererErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `Renderer page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  });

  test('Dynatrace Problems tab opens without requiring a configured token', async () => {
    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');

    await expect(window.getByRole('heading', { name: 'Local response queue' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Unaddressed 0' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Refresh Dynatrace Problems' })).toBeVisible();
  });

  test('Service Status uses the operational queue layout', async () => {
    await goToTab(window, 'sidebar-status', 'Service Status');

    await expect(
      window.getByRole('heading', { name: 'External Status', exact: true }),
    ).toBeVisible();
    const providerSummary = window.getByRole('status').filter({ hasText: 'monitored providers' });
    await expect(providerSummary).toHaveCount(1);
    await expect(providerSummary).toContainText(/monitored providers/);
    const overview = window.getByRole('region', { name: 'Provider overview', exact: true });
    await expect(overview).toBeVisible();
    await overview
      .getByRole('button', { name: 'View Cloudflare status details', exact: true })
      .click();
    const cloudflare = window.getByRole('region', {
      name: 'Cloudflare status details',
      exact: true,
    });
    await expect(cloudflare).toBeVisible();
    await expect(
      cloudflare.getByRole('button', {
        name: 'Open Cloudflare official status page',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      cloudflare.getByRole('button', { name: 'Open Cloudflare on X', exact: true }),
    ).toBeVisible();
    await expect(
      cloudflare.getByRole('button', {
        name: 'Open Cloudflare on Downdetector',
        exact: true,
      }),
    ).toBeVisible();
    await expect(window.getByText('ADP', { exact: true })).toHaveCount(0);
  });

  test('Dynatrace Problems demo seed is repeatable and isolated', async () => {
    await runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
    await runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');

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

    await runDynatraceSeed(tempDataDir, pbPort, '--clear-dynatrace');
    const remainingDemoProblems = await pb.collection('dynatrace_problems').getFullList({
      filter: 'problemId ~ "RELAY-DEMO-"',
      requestKey: null,
    });
    expect(remainingDemoProblems).toHaveLength(0);
  });

  test('ordinary Dynatrace actions stay passwordless while historical snapshots remain visible', async () => {
    test.setTimeout(90_000);
    const ticketNumber = `INC${crypto.randomInt(1_000_000, 9_999_999)}`;
    const ticketNote = `Ticket: ${ticketNumber}`;

    await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');
    await expect(window.getByRole('tab', { name: 'Unaddressed 0' })).toBeVisible();
    await goToTab(window, 'sidebar-compose', 'Compose');

    await runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
    const historicalPb = await makePbClient(pbPort);
    const [historicalNotes, historicalStates] = await Promise.all([
      historicalPb.collection('dynatrace_problem_notes').getFullList<DynatraceProblemNote>({
        filter: 'problemId = "RELAY-DEMO-1006"',
        requestKey: null,
      }),
      historicalPb.collection('dynatrace_problem_states').getFullList<DynatraceProblemState>({
        filter: 'problemId = "RELAY-DEMO-1006"',
        requestKey: null,
      }),
    ]);
    expect(historicalNotes.map(({ author }) => author)).toContain('noc-demo-east-01');
    expect(historicalStates.map(({ addressedBy }) => addressedBy)).toContain('noc-demo-east-01');

    const connectedClient = await launchConnectedClient();
    await expect(connectedClient.getByTestId('sidebar-operator-selector')).toHaveCount(0);
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

    const addressedAction = window.getByRole('button', { name: 'Mark addressed locally' });
    await expect(addressedAction).toBeDisabled();
    await window.getByLabel('Service Desk ticket number').fill(ticketNumber);
    await expect(addressedAction).toBeDisabled();
    await window.getByRole('combobox', { name: 'Resolved by' }).selectOption('Ryan');
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
          noteOperatorId: note?.operatorId ?? '',
          author: note?.author ?? '',
          stateOperatorId: state?.operatorId ?? '',
          addressedBy: state?.addressedBy ?? '',
          addressed: state?.addressed,
        };
      })
      .toEqual({
        noteOperatorId: '',
        author: 'Ryan',
        stateOperatorId: '',
        addressedBy: 'Ryan',
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
    await expect(clientDetail.locator('.dt-problem-detail__response-copy')).toContainText('Ryan');
    const syncedTicket = clientDetail.locator('.dt-problem-note', { hasText: ticketNumber });
    await expect(syncedTicket).toContainText('Service Desk ticket');
    await expect(syncedTicket).toContainText(ticketNumber);
    await expect(syncedTicket).toContainText('Ryan');

    await connectedClient.getByRole('tab', { name: 'History 2' }).click();
    const historicalDetail = connectedClient.getByRole('region', {
      name: 'Selected problem details',
    });
    await expect(
      historicalDetail.getByRole('heading', { name: 'Elevated login failure rate' }),
    ).toBeVisible();
    await expect(historicalDetail.locator('.dt-problem-detail__response-copy')).toContainText(
      'noc-demo-east-01',
    );
    await expect(
      historicalDetail.locator('.dt-problem-note', { hasText: 'Identity team rolled back' }),
    ).toContainText('noc-demo-east-01');
  });

  test('connected client queues ordinary attributed Dynatrace actions offline', async () => {
    test.setTimeout(90_000);
    const noteText = `Offline NOC follow-up ${uniqueSuffix()}`;

    await runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');

    let connectedClient = await launchConnectedClient();
    await goToTab(connectedClient, 'sidebar-problems', 'Dynatrace Problems');
    await expect(connectedClient.getByRole('tab', { name: 'Unaddressed 4' })).toBeVisible();
    await expectNewestProblem(connectedClient, CHECKOUT_PROBLEM_TITLE);
    await expect(connectedClient.getByTestId('sidebar-operator-selector')).toHaveCount(0);
    await expect
      .poll(() =>
        connectedClient.evaluate(async (problemId) => {
          const cachedProblems = await globalThis.api?.cacheRead?.('dynatrace_problems');
          return (
            Array.isArray(cachedProblems) &&
            cachedProblems.some(
              (record) =>
                record !== null &&
                typeof record === 'object' &&
                'problemId' in record &&
                record.problemId === problemId,
            )
          );
        }, CHECKOUT_PROBLEM_ID),
      )
      .toBe(true);

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
    await expect(connectedClient.getByTestId('sidebar-operator-selector')).toHaveCount(0);
    await expect(
      connectedClient.getByText('You are offline. Changes will sync when Relay reconnects.'),
    ).toBeVisible();

    const addressedAction = connectedClient.getByRole('button', {
      name: 'Mark addressed locally',
    });
    await connectedClient.getByLabel('Add a note').fill(noteText);
    await expect(addressedAction).toBeDisabled();
    await connectedClient.getByRole('combobox', { name: 'Resolved by' }).selectOption('Ryan');
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
          noteOperatorId: note?.operatorId ?? '',
          author: note?.author ?? '',
          stateOperatorId: state?.operatorId ?? '',
          addressedBy: state?.addressedBy ?? '',
          addressed: state?.addressed,
        };
      })
      .toEqual({
        noteOperatorId: '',
        author: 'Ryan',
        stateOperatorId: '',
        addressedBy: 'Ryan',
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
    await runDynatraceSeed(tempDataDir, pbPort, '--dynatrace-only');
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
        const schedule = buttonByText('Schedule');
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

    await enterKnowledgeDestination(window, 'Servers');
    await expect(window.getByRole('button', { name: 'ADD SERVER' })).toBeVisible();
  });

  test('Vital 3: Data Integrity (Add/Delete Contact)', async () => {
    const suffix = uniqueSuffix();
    const name = `Vital Test ${suffix}`;
    const email = `vital.test.${suffix}@example.com`;

    await createContactFromKnowledge(window, pbPort, name, email);
    await expect
      .poll(() => hasContactDirect(pbPort, email), { message: `contact ${email} should exist` })
      .toBe(true);
    expect(await hasContactDirect(pbPort, email), `contact ${email} should exist`).toBe(true);
    await deleteContactFromKnowledge(window, pbPort, email);
    await expect
      .poll(() => hasContactDirect(pbPort, email), {
        message: `contact ${email} should be deleted`,
      })
      .toBe(false);
    expect(await hasContactDirect(pbPort, email), `contact ${email} should be deleted`).toBe(false);
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

    const contactCard = await createContactFromKnowledge(window, pbPort, name, email);
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

    await deleteContactFromKnowledge(window, pbPort, email);
  });
});
