import { expect, test } from '@playwright/test';
import { injectMockApi } from './mocks';

test.describe('Application Shell', () => {
  test.beforeEach(async ({ page }) => {
    // Inject the mock API before any navigation
    await injectMockApi(page);
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    // Clean up any global state to prevent cross-test pollution
    await page.evaluate(() => {
      delete (globalThis as any).__triggerReloadStart;
      delete (globalThis as any).__triggerReloadComplete;
    });
  });


  test('navigates between tabs and visual check', async ({ page }) => {
    const composeTab = page.locator('[data-testid="sidebar-compose"]');
    const peopleTab = page.locator('[data-testid="sidebar-people"]');
    const radarTab = page.locator('[data-testid="sidebar-radar"]');

    // Check initial state (Compose is active)
    await expect(composeTab).toHaveAttribute('data-active', 'true');
    await expect(page.getByText('Groups', { exact: false })).toBeVisible();

    // Visual test for Compose tab
    await expect(page).toHaveScreenshot('compose-tab.png', {
      mask: [page.locator('.clock')]
    });

    // Navigate to People (Directory)
    await peopleTab.click();
    await expect(peopleTab).toHaveAttribute('data-active', 'true');
    await expect(page.getByPlaceholder('Search people...')).toBeVisible();

    // Visual test for People tab
    await expect(page).toHaveScreenshot('people-tab.png', {
      mask: [page.locator('.clock')]
    });

    // Navigate to Radar (Live)
    await radarTab.click();
    await expect(radarTab).toHaveAttribute('data-active', 'true');
  });

  test('assembler logic: selection and manual entry', async ({ page }) => {
    // Verify groups from mock are loaded
    const groupName = 'Alpha Team';
    await expect(page.getByRole('button', { name: new RegExp(groupName) })).toBeVisible();

    // Toggle Group to add members
    await page.getByRole('button', { name: new RegExp(groupName) }).click();

    // Verify log populated with group members (emails shown in contact cards)
    await expect(page.getByText('alpha1@agency.net')).toBeVisible();
    await expect(page.getByText('alpha2@agency.net')).toBeVisible();

    // Manual Entry via quick add
    const adhocEmail = 'adhoc@agency.net';
    await page.getByPlaceholder('Add by email...').fill(adhocEmail);
    await page.getByPlaceholder('Add by email...').press('Enter');

    // Verify ad-hoc added immediately to the list (look for the email in a contact card)
    const adhocCard = page.locator('.contact-card-hover', { has: page.getByText(adhocEmail) });
    await expect(adhocCard).toBeVisible();

    // Visual check for selection state
    await expect(page).toHaveScreenshot('compose-selection.png', {
      mask: [page.locator('.clock')]
    });

    // Right-click to trigger context menu on the adhoc contact
    await adhocCard.click({ button: 'right' });

    // Click "Save to Contacts" from context menu
    await page.getByText('Save to Contacts').click();

    // Modal should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Visual check for Modal
    await expect(dialog).toHaveScreenshot('add-contact-modal.png');

    await page.getByPlaceholder('e.g. Alice Smith').fill('Adhoc User');
    await page.getByRole('button', { name: 'Create Contact', exact: true }).click();

    // Reset
    await page.getByRole('button', { name: 'Reset' }).click();

    // Verify empty state
    await expect(page.getByText('No recipients selected')).toBeVisible();
  });

  test('directory search adds to assembler', async ({ page }) => {
    const peopleTab = page.locator('[data-testid="sidebar-people"]');
    const composeTab = page.locator('[data-testid="sidebar-compose"]');

    // Go to People (Directory)
    await peopleTab.click();
    await expect(page.getByText('Personnel Directory')).toBeVisible();

    // Search
    const searchInput = page.getByPlaceholder('Search people...');
    await searchInput.fill('Jane');

    // Verify filter shows Jane Smith
    await expect(page.getByText('Jane Smith')).toBeVisible();

    // Right-click on Jane Smith row to open context menu
    const janeCard = page.locator('.contact-card-hover', { has: page.getByText('Jane Smith') });
    await janeCard.click({ button: 'right' });

    // Add to Composer via context menu
    await page.getByText('Add to Composer').click();

    // Go back to Compose (Assembler)
    await composeTab.click();

    // Verify Jane added (look for her email)
    await expect(page.getByText('jane.smith@agency.net')).toBeVisible();
  });
});
