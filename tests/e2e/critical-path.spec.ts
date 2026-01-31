
/* eslint-disable no-undef */
import { _electron as electron, test, expect, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Vital Critical Path', () => {
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async ({ page: _page }, testInfo) => {
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    electronApp = await electron.launch({
      args: [mainEntry],
      env: { ...process.env, NODE_ENV: 'test' }
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test('Vital 1: App Launch & Compose Tab', async () => {
    const title = await window.title();
    expect(title).toMatch(/Relay/i);
    await expect(window.locator('text=Data Composition')).toBeVisible({ timeout: 15000 });
  });

  test('Vital 2: Navigation to On-Call & Weather', async () => {
    // Navigate to On-Call Board
    await window.click('[data-testid="sidebar-on-call-board"]');
    await expect(window.locator('h1:has-text("On-Call Board")')).toBeVisible();

    // Navigate to Weather
    await window.click('[data-testid="sidebar-weather"]');
    await expect(window.locator('header')).toBeVisible();
  });

  test('Vital 3: Data Integrity (Add/Delete Contact)', async () => {
    await window.click('[data-testid="sidebar-people"]');
    await expect(window.locator('text=Personnel Directory')).toBeVisible();

    await window.click('button:has-text("ADD CONTACT")');
    const modal = window.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    const uniqueId = Date.now();
    const testEmail = `vital.test.${uniqueId}@example.com`;
    await modal.getByLabel(/Full Name/i).fill('Vital Test User');
    await modal.getByLabel(/Email Address/i).fill(testEmail);
    await modal.getByLabel(/Phone Number/i).fill('555-9999');
    await modal.getByLabel(/Title/i).fill('Tester');
    
    await modal.getByRole('button', { name: /Create Contact/i }).click();
    await expect(modal).not.toBeVisible();

    const searchInput = window.locator('input[placeholder="Search people..."]');
    await searchInput.fill(testEmail);
    const targetCard = window.locator('text=' + testEmail).first();
    await expect(targetCard).toBeVisible();
    
    // Right click via evaluate to be stable in virtualized list
    await targetCard.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const event = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
      el.dispatchEvent(event);
    });
    
    const deleteOption = window.locator('.animate-scale-in').getByText('Delete', { exact: true });
    await expect(deleteOption).toBeVisible({ timeout: 10000 });
    await deleteOption.click();
    
    const confirmModal = window.locator('div[role="dialog"]', { hasText: /Delete Contact/i });
    await expect(confirmModal).toBeVisible();
    await confirmModal.getByRole('button', { name: /Delete Contact/i }).click();
    
    await expect(window.locator(`text=${testEmail}`)).not.toBeVisible();
  });

  test('Vital 4: On-Call Management (Add/Rename Team & Rows)', async () => {
    await window.click('[data-testid="sidebar-on-call-board"]');
    
    // 1. Add Team
    await window.click('button:has-text("+ ADD CARD")');
    const addModal = window.locator('div[role="dialog"]', { hasText: /Add New Card/i });
    await expect(addModal).toBeVisible();
    
    const teamName = `Vital Team ${Date.now()}`;
    await addModal.getByPlaceholder(/Card Name/i).fill(teamName);
    await addModal.getByRole('button', { name: 'Add Card' }).click();
    await expect(addModal).not.toBeVisible();
    
    const teamHeader = window.locator('.oncall-grid').locator(`text=${teamName}`);
    await expect(teamHeader).toBeVisible();

    // 2. Add Rows to Team
    // For a new (empty) team, we can simply click it to open the edit modal
    const targetCard = window.locator('.oncall-grid-item', { hasText: teamName }).locator('[role="button"]').first();
    await targetCard.scrollIntoViewIfNeeded();
    await targetCard.click({ force: true });
    
    const editModal = window.locator('div[role="dialog"]', { hasText: /Edit Card/i });
    await expect(editModal).toBeVisible({ timeout: 10000 });
    
    // Add Row 1
    await editModal.getByText('+ Add Row').click();
    const roleInput1 = editModal.getByPlaceholder('Role').last();
    await roleInput1.fill('Primary');
    await roleInput1.press('Enter');
    const nameInput1 = editModal.getByPlaceholder('Select Contact...').last();
    await nameInput1.fill('Person One');
    await nameInput1.press('Enter');
    
    // Add Row 2
    await editModal.getByText('+ Add Row').click();
    const roleInput2 = editModal.getByPlaceholder('Role').last();
    await roleInput2.fill('Backup');
    await roleInput2.press('Enter');
    const nameInput2 = editModal.getByPlaceholder('Select Contact...').last();
    await nameInput2.fill('Person Two');
    await nameInput2.press('Enter');

    // Remove Row 2
    const removeButtons = editModal.locator('div[style*="color: var(--color-danger)"]');
    await removeButtons.last().click();

    await editModal.getByRole('button', { name: 'Save Changes' }).click();
    await expect(editModal).not.toBeVisible();
    
    // Verify Row 1 Visible on Card
    await expect(targetCard.locator('text=Person One')).toBeVisible();

    // 3. Rename Team
    const box = await targetCard.boundingBox();
    if (box) {
      await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    }
    const renameOption = window.getByText('Rename Team');
    await expect(renameOption).toBeVisible({ timeout: 10000 });
    await renameOption.click({ force: true });
    
    const renameModal = window.locator('div[role="dialog"]', { hasText: /Rename Card/i });
    await expect(renameModal).toBeVisible();
    
    const newName = `${teamName} Renamed`;
    const input = renameModal.locator('input');
    await input.clear();
    await input.fill(newName);
    
    await renameModal.getByRole('button', { name: 'Rename' }).click();
    await expect(renameModal).not.toBeVisible();
    
    await expect(window.locator('.oncall-grid').locator(`text=${newName}`)).toBeVisible();
    
    // 4. Cleanup (Remove Team)
    const renamedCard = window.locator('.oncall-grid-item', { hasText: newName }).locator('[role="button"]').first();
    const boxRenamed = await renamedCard.boundingBox();
    if (boxRenamed) {
      await window.mouse.click(boxRenamed.x + boxRenamed.width / 2, boxRenamed.y + boxRenamed.height / 2, { button: 'right' });
    }
    const removeOption = window.getByText('Remove Team');
    await expect(removeOption).toBeVisible({ timeout: 10000 });
    await removeOption.click({ force: true });
    
    const confirmModal = window.locator('div[role="dialog"]', { hasText: /Remove Card/i });
    await expect(confirmModal).toBeVisible();
    await confirmModal.getByRole('button', { name: 'Remove' }).click();
    
    await expect(window.locator('.oncall-grid').locator(`text=${newName}`)).not.toBeVisible();
  });

  test('Vital 5: Composer Workflow (Add, Group, Draft)', async () => {
    // 1. Create a contact to use
    await window.click('[data-testid="sidebar-people"]');
    await window.click('button:has-text("ADD CONTACT")');
    const uniqueId = Date.now();
    const email = `composer.test.${uniqueId}@example.com`;
    await window.locator('div[role="dialog"]').getByLabel(/Email Address/i).fill(email);
    await window.locator('div[role="dialog"]').getByLabel(/Full Name/i).fill('Composer Test User');
    await window.locator('div[role="dialog"]').getByRole('button', { name: /Create Contact/i }).click();
    await expect(window.locator('div[role="dialog"]')).not.toBeVisible();
    
    // 2. Add to Composer from Directory
    const searchInput = window.locator('input[placeholder="Search people..."]');
    await searchInput.fill(email);
    const targetCard = window.locator('text=' + email).first();
    await expect(targetCard).toBeVisible();
    await targetCard.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const event = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
      el.dispatchEvent(event);
    });
    
    const addToComposerOption = window.locator('.animate-scale-in').getByText('Add to Composer');
    await expect(addToComposerOption).toBeVisible({ timeout: 15000 });
    await addToComposerOption.click();
    
    // 3. Verify in Compose Tab
    await window.click('[data-testid="sidebar-compose"]');
    await expect(window.locator(`text=${email}`)).toBeVisible();
    
    // 4. Save Group
    await window.click('button:has-text("SAVE GROUP")');
    const saveModal = window.locator('div[role="dialog"]', { hasText: /Save as Group/i });
    await expect(saveModal).toBeVisible();
    
    const groupName = `Vital Group ${uniqueId}`;
    await saveModal.getByLabel('Group Name').fill(groupName);
    await saveModal.getByRole('button', { name: 'Save' }).click();
    await expect(saveModal).not.toBeVisible();
    
    // Verify group in sidebar
    await expect(window.locator(`button`, { hasText: groupName })).toBeVisible();
    
    // 5. Draft Bridge (Start Bridge)
    await window.click('button:has-text("DRAFT BRIDGE")');
    const reminderModal = window.locator('div[role="dialog"]', { hasText: /Meeting Recording/i });
    await expect(reminderModal).toBeVisible();
    await reminderModal.getByRole('button', { name: /I Understand/i }).click();
    await expect(reminderModal).not.toBeVisible();
    
    // Cleanup Group
    const groupItem = window.locator(`button`, { hasText: groupName });
    await groupItem.click({ button: 'right', force: true });
    const deleteGroupOption = window.locator('.animate-scale-in').getByText('Delete Group');
    await expect(deleteGroupOption).toBeVisible();
    await deleteGroupOption.dispatchEvent('click');
    
    // Cleanup Contact
    await window.click('[data-testid="sidebar-people"]');
    await searchInput.fill(email);
    const cleanupCard = window.locator('text=' + email).first();
    await expect(cleanupCard).toBeVisible();
    await cleanupCard.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const event = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      });
      el.dispatchEvent(event);
    });
    const deleteContactOption = window.locator('.animate-scale-in').getByText('Delete', { exact: true });
    await expect(deleteContactOption).toBeVisible({ timeout: 15000 });
    await deleteContactOption.click();
    
    await window.locator('div[role="dialog"]', { hasText: /Delete Contact/i }).getByRole('button', { name: /Delete Contact/i }).click();
  });
});
