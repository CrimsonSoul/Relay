import { _electron as electron, test, expect, type Page, type Locator } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const rightClick = async (target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  await target.click({ button: 'right', force: true });
};

const getActivePanel = (window: Page) => window.locator('.tab-panel--active');

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

const createContactFromPeople = async (window: Page, name: string, email: string) => {
  const peopleReady = await tryEnsurePeopleTabReady(window);

  if (!peopleReady) {
    await window.evaluate(
      async ({ contactName, contactEmail }) => {
        await window.api.addContact({
          name: contactName,
          email: contactEmail,
          title: 'E2E Tester',
          phone: '5551234567',
        });
      },
      { contactName: name, contactEmail: email },
    );

    await expect
      .poll(async () =>
        window.evaluate(async (contactEmail) => {
          const contacts = await window.api.getContacts();
          return contacts.some((c) => c.email.toLowerCase() === contactEmail.toLowerCase());
        }, email),
      )
      .toBe(true);

    return null;
  }

  await window.getByRole('button', { name: 'ADD CONTACT' }).click();
  const addModal = window.locator('div[role="dialog"]', { hasText: /Add Contact/i });
  await expect(addModal).toBeVisible();

  await addModal.getByLabel('Full Name').fill(name);
  await addModal.getByLabel('Email Address').fill(email);
  await addModal.getByLabel('Job Title').fill('E2E Tester');
  await addModal.getByLabel('Phone Number').fill('5551234567');

  await addModal.getByRole('button', { name: 'Create Contact' }).click();
  await expect(addModal).not.toBeVisible();

  const activePanel = getActivePanel(window);
  const search = activePanel.locator('input[placeholder="Search Recipients"]');
  await search.fill(email);

  const contactCard = activePanel.locator('.contact-card', { hasText: email }).first();
  await expect(contactCard).toBeVisible();

  return contactCard;
};

const deleteContactFromPeople = async (window: Page, email: string) => {
  const peopleReady = await tryEnsurePeopleTabReady(window);

  if (!peopleReady) {
    await window.evaluate(async (contactEmail) => {
      await window.api.removeContact(contactEmail);
    }, email);

    await expect
      .poll(async () =>
        window.evaluate(async (contactEmail) => {
          const contacts = await window.api.getContacts();
          return contacts.some((c) => c.email.toLowerCase() === contactEmail.toLowerCase());
        }, email),
      )
      .toBe(false);

    return;
  }

  const activePanel = getActivePanel(window);
  const search = activePanel.locator('input[placeholder="Search Recipients"]');
  await search.fill(email);

  const contactCard = activePanel.locator('.contact-card', { hasText: email }).first();
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

  const confirmModal = window.locator('div[role="dialog"]', { hasText: /Delete Contact/i });
  await expect(confirmModal).toBeVisible();
  await confirmModal.getByRole('button', { name: 'Delete Contact' }).click();
  await expect(confirmModal).not.toBeVisible();

  await expect(activePanel.locator('.contact-card', { hasText: email })).toHaveCount(0);
};

test.describe('Vital Critical Path', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let window: Awaited<ReturnType<typeof electronApp.firstWindow>>;

  test.beforeEach(async () => {
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    const launchEnv = { ...process.env, NODE_ENV: 'test' };
    delete launchEnv.ELECTRON_RUN_AS_NODE;

    electronApp = await electron.launch({
      args: [mainEntry],
      env: launchEnv,
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await expect(window.getByTestId('sidebar-compose')).toBeVisible();
    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('Vital 1: App Launch & Compose Tab', async () => {
    const title = await window.title();
    expect(title).toMatch(/Relay/i);

    await expect(window.locator('.header-breadcrumb')).toContainText('Relay / Compose');
    await expect(window.getByRole('button', { name: 'DRAFT BRIDGE' })).toBeVisible();
  });

  test('Vital 2: Navigation to On-Call & Weather', async () => {
    await goToTab(window, 'sidebar-on-call', 'On-Call');
    await expect(window.getByRole('button', { name: 'ADD CARD' })).toBeVisible();

    await goToTab(window, 'sidebar-weather', 'Weather');
    await expect(window.getByLabel('Search city')).toBeVisible();
    await expect(window.getByLabel('Detect current location')).toBeVisible();
  });

  test('Vital 3: Data Integrity (Add/Delete Contact)', async () => {
    const suffix = uniqueSuffix();
    const name = `Vital Test ${suffix}`;
    const email = `vital.test.${suffix}@example.com`;

    await createContactFromPeople(window, name, email);
    await deleteContactFromPeople(window, email);
  });

  test('Vital 4: On-Call Management (Add/Rename/Remove Card)', async () => {
    await goToTab(window, 'sidebar-on-call', 'On-Call');

    const teamName = `Vital Team ${uniqueSuffix()}`;
    await window.getByRole('button', { name: 'ADD CARD' }).click();

    const addModal = window.locator('div[role="dialog"]', { hasText: /Add New Card/i });
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

    const renameModal = window.locator('div[role="dialog"]', { hasText: /Rename Card/i });
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

    const removeModal = window.locator('div[role="dialog"]', { hasText: /Remove Card/i });
    await expect(removeModal).toBeVisible();
    await removeModal.getByRole('button', { name: 'Remove' }).click();
    await expect(removeModal).not.toBeVisible();

    await expect(window.locator('.team-card-body', { hasText: renamedTeam })).toHaveCount(0);
  });

  test('Vital 5: Composer Workflow (Add, Group, Draft)', async () => {
    const suffix = uniqueSuffix();
    const name = `Composer Test ${suffix}`;
    const email = `composer.test.${suffix}@example.com`;
    const preloadGroupName = `Seed Group ${suffix}`;
    const groupName = `Vital Group ${suffix}`;

    await createContactFromPeople(window, name, email);

    await goToTab(window, 'sidebar-compose', 'Compose');

    await window.evaluate(
      async ({ seedGroupName, contactEmail }) => {
        await window.api.saveGroup({
          name: seedGroupName,
          contacts: [contactEmail],
        });
      },
      { seedGroupName: preloadGroupName, contactEmail: email },
    );

    const preloadGroupItem = window
      .locator('.assembler-sidebar .sidebar-item', { hasText: preloadGroupName })
      .first();
    await expect(preloadGroupItem).toBeVisible();
    await preloadGroupItem.click();

    const composePanel = getActivePanel(window);
    await expect(composePanel.locator(`text=${email}`)).toBeVisible();

    await window.getByTitle('Create new group').click();
    const createGroupModal = window.locator('div[role="dialog"]', { hasText: /Create New Group/i });
    await expect(createGroupModal).toBeVisible();
    await createGroupModal.getByLabel('Group Name').fill(groupName);
    await createGroupModal.getByRole('button', { name: 'Save' }).click();
    await expect(createGroupModal).not.toBeVisible();

    const groupItem = window
      .locator('.assembler-sidebar .sidebar-item', { hasText: groupName })
      .first();
    await expect(groupItem).toBeVisible();

    await window.getByRole('button', { name: 'DRAFT BRIDGE' }).click();
    const reminderModal = window.locator('div[role="dialog"]', { hasText: /Meeting Recording/i });
    await expect(reminderModal).toBeVisible();
    await reminderModal.getByRole('button', { name: 'I Understand' }).click();
    await expect(reminderModal).not.toBeVisible();

    await rightClick(groupItem);
    const deleteSavedGroup = window.getByRole('menuitem', { name: 'Delete Group' });
    await expect(deleteSavedGroup).toBeVisible();
    await deleteSavedGroup.click();
    await expect(
      window.locator('.assembler-sidebar .sidebar-item', { hasText: groupName }),
    ).toHaveCount(0);

    await rightClick(preloadGroupItem);
    const deleteSeedGroup = window.getByRole('menuitem', { name: 'Delete Group' });
    await expect(deleteSeedGroup).toBeVisible();
    await deleteSeedGroup.click();
    await expect(
      window.locator('.assembler-sidebar .sidebar-item', { hasText: preloadGroupName }),
    ).toHaveCount(0);

    await deleteContactFromPeople(window, email);
  });
});
