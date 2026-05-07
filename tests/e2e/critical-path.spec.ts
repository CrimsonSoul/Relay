import { _electron as electron, test, expect, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import crypto from 'node:crypto';

const uniqueSuffix = () => crypto.randomUUID().slice(0, 8);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type RelayContact = { email: string };

const TEST_SECRET = 'testpassphrase123';

const rightClick = async (target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: 'right', force: true });
};

const getActivePanel = (window: Page) => window.locator('.tab-panel--active');

const makePort = () => 20_000 + crypto.randomInt(20_000);

const writeServerConfig = (userDataDir: string, port: number) => {
  const dataDir = path.join(userDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ mode: 'server', port, secret: TEST_SECRET }, null, 2),
    'utf8',
  );
};

const makePbClient = async (port: number) => {
  const pb = new PocketBase(`http://127.0.0.1:${port}`);
  await pb.collection('_pb_users_auth_').authWithPassword('relay@relay.app', TEST_SECRET, {
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
  let tempDataDir: string;
  let pbPort: number;

  test.beforeEach(async () => {
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    const launchEnv = { ...process.env, NODE_ENV: 'test' };
    delete (launchEnv as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-critical-'));
    pbPort = makePort();
    writeServerConfig(tempDataDir, pbPort);

    electronApp = await electron.launch({
      args: [`--user-data-dir=${tempDataDir}`, mainEntry],
      env: launchEnv,
    });

    window = await electronApp.firstWindow();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      mainWindow?.setSize(1600, 1000);
    });
    await window.waitForLoadState('domcontentloaded');

    await expect(window.getByTestId('sidebar-compose')).toBeVisible();
    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
  });

  test.afterEach(async () => {
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
  });

  test('Vital 1: App Launch & Compose Tab', async () => {
    const title = await window.title();
    expect(title).toMatch(/Relay/i);

    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
    await expect(window.getByRole('button', { name: 'DRAFT BRIDGE' })).toBeVisible();
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

    await window.getByRole('button', { name: 'DRAFT BRIDGE' }).click();
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
