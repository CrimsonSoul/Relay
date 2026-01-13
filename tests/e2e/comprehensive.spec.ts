import { expect, test } from '@playwright/test';
import { injectMockApi, MOCK_DATA } from './mocks';
import { WeatherData, WeatherAlert } from '../../src/shared/ipc';

const MOCK_WEATHER: WeatherData = {
  current_weather: {
    temperature: 72,
    windspeed: 5,
    winddirection: 180,
    weathercode: 1, // Clear
    time: new Date().toISOString()
  },
  hourly: {
    time: Array(24).fill(0).map((_, i) => new Date(Date.now() + i * 3600000).toISOString()),
    temperature_2m: Array(24).fill(72),
    weathercode: Array(24).fill(1),
    precipitation_probability: Array(24).fill(0)
  },
  daily: {
    time: [new Date().toISOString().split('T')[0]],
    weathercode: [1],
    temperature_2m_max: [75],
    temperature_2m_min: [68],
    wind_speed_10m_max: [10],
    precipitation_probability_max: [0]
  }
};

const MOCK_ALERT: WeatherAlert = {
  id: 'alert_1',
  event: 'Severe Thunderstorm Warning',
  headline: 'Severe Thunderstorm Warning issued for New York',
  description: 'A severe thunderstorm is approaching...',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  effective: new Date().toISOString(),
  expires: new Date(Date.now() + 3600000).toISOString(),
  senderName: 'NWS',
  areaDesc: 'New York, NY'
};

test.describe('Comprehensive E2E Suite', () => {
  test('Weather Tab: Displays data and handles search', async ({ page }) => {
    await injectMockApi(page, { mockWeather: MOCK_WEATHER });
    await page.goto('/');
    
    await page.locator('[data-testid="sidebar-weather"]').click();

    await expect(page.getByText(/72°F/).first()).toBeVisible();
    await expect(page.getByText(/Clear/i).first()).toBeVisible();

    const searchInput = page.getByPlaceholder('Search city...');
    await expect(searchInput).toBeVisible();
    
    await searchInput.fill('New York');
    await searchInput.press('Enter');
    
    await expect(page.locator('button[title="Detect Location"]')).toBeVisible();
  });

  test('Weather Alerts: Displays severe warning toast and card', async ({ page }) => {
    await injectMockApi(page, { 
      mockWeather: MOCK_WEATHER,
      mockAlerts: [MOCK_ALERT]
    });
    
    await page.goto('/');
    await page.locator('[data-testid="sidebar-weather"]').click();
    
    // Check for Toast
    await expect(page.getByText(/Weather Alert: Severe Thunderstorm Warning/)).toBeVisible();
    
    // Check for Alert Card on Weather Tab
    await expect(page.getByText('Severe Thunderstorm Warning', { exact: true })).toBeVisible();
  });

  test('Server Management: Add and Remove Server', async ({ page }) => {
    await injectMockApi(page);
    await page.goto('/');
    await page.locator('[data-testid="sidebar-servers"]').click();

    await page.getByRole('button', { name: /ADD SERVER/i }).click();
    
    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    await modal.getByLabel(/Server Name/i).fill('TEST-SERVER');
    await modal.getByLabel(/Business Area/i).fill('Testing');
    await modal.getByLabel('LOB', { exact: true }).fill('DevOps');
    await modal.getByPlaceholder('e.g. Windows').fill('Linux');
    await modal.getByRole('button', { name: /Save Server/i }).click();

    await expect(modal).not.toBeVisible();
    
    await page.waitForTimeout(500);
    await expect(page.getByText(/TEST-SERVER/i).first()).toBeVisible({ timeout: 15000 });

    const serverCard = page.locator('.server-card-hover', { hasText: /TEST-SERVER/i }).first();
    await serverCard.click({ button: 'right' });
    await page.getByText('Delete Server', { exact: true }).click();

    await expect(page.getByText(/TEST-SERVER/i)).not.toBeVisible();
  });

  test('Personnel & On-Call: Tab access and layout', async ({ page }) => {
    await injectMockApi(page);
    await page.goto('/');
    await page.locator('[data-testid="sidebar-on-call-board"]').click();

    await expect(page.getByText('On-Call Board', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add Team/i })).toBeVisible();
  });

  test('AI Chat: Tab access and sub-tabs', async ({ page }) => {
    await injectMockApi(page);
    await page.goto('/');
    await page.locator('[data-testid="sidebar-ai-chat"]').click();

    await expect(page.getByText('AI Chat', { exact: true })).toBeVisible();
    
    const geminiBtn = page.getByRole('button', { name: 'Gemini' });
    const gptBtn = page.getByRole('button', { name: 'ChatGPT' });
    
    await expect(geminiBtn).toBeVisible();
    await gptBtn.click();
    await expect(gptBtn).toHaveClass(/tactile-button--primary/);
  });

  test('People: Directory search and management', async ({ page }) => {
    await injectMockApi(page);
    await page.goto('/');
    await page.locator('[data-testid="sidebar-people"]').click();

    await expect(page.getByText('Personnel Directory', { exact: true })).toBeVisible();
    
    // Add Contact
    await page.getByRole('button', { name: /ADD CONTACT/i }).click();
    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    
    await modal.getByLabel(/Full Name/i).fill('Test User');
    await modal.getByLabel(/Email Address/i).fill('test@user.net');
    await modal.getByRole('button', { name: /Create Contact/i }).click();
    
    await expect(modal).not.toBeVisible();
    
    const searchInput = page.getByPlaceholder('Search people...');
    await searchInput.fill('Test User');
    await expect(page.getByText('test@user.net').first()).toBeVisible({ timeout: 15000 });

    // Delete Contact
    const contactCard = page.locator('.contact-card-hover', { hasText: 'Test User' });
    await contactCard.click({ button: 'right' });
    await page.getByText('Delete', { exact: true }).click();
    
    const confirmModal = page.locator('div[role="dialog"]', { hasText: /Delete Contact/i });
    await confirmModal.getByRole('button', { name: /Delete Contact/i }).click();
    
    await expect(page.getByText('test@user.net')).not.toBeVisible();
  });

  test('Global UI: Command Palette, Shortcuts and Clock', async ({ page }) => {
    await injectMockApi(page);
    await page.goto('/');
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    // World Clock
    await expect(page.locator('.world-clock-container')).toBeVisible();

    // Command Palette
    await page.keyboard.press(`${modifier}+k`);
    const paletteInput = page.getByPlaceholder(/Search contacts/);
    await expect(paletteInput).toBeVisible();
    
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await expect(paletteInput).not.toBeVisible({ timeout: 10000 });

    // Shortcuts Modal
    await page.keyboard.press(`${modifier}+Shift+?`);
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible();
    
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Keyboard Shortcuts')).not.toBeVisible();

    // Settings Modal
    await page.locator('[data-testid="sidebar-settings"]').click();
    await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  });

  test('Radar: Page loading', async ({ page }) => {
    await injectMockApi(page);
    await page.goto('/');
    await page.locator('[data-testid="sidebar-radar"]').click();
    await expect(page.getByText('Dispatcher Radar', { exact: true })).toBeVisible();
  });
});
