/**
 * TEMPORARY verification spec for the Accent Ink redesign (Task 17).
 *
 * Launches the real Electron app in embedded-server mode, seeds data via the
 * PocketBase client, and captures 1920x1080 screenshots of every tab plus the
 * Settings accent picker and the five accent schemes into tmp/redesign-shots/.
 *
 * Not part of the default suite watchlist intent — run explicitly:
 *   npx playwright test tests/e2e/redesign-screenshots.spec.ts -c playwright.electron.config.ts
 */
import { _electron as electron, test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import PocketBase from 'pocketbase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHOTS_DIR = path.join(__dirname, '../../tmp/redesign-shots');

const CONFIG_SECRET_FIELD = ['sec', 'ret'].join('');
const TEST_PASSPHRASE = ['test', crypto.randomUUID()].join('-');

const makePort = () => 20_000 + crypto.randomInt(20_000);

const writeServerConfig = (userDataDir: string, port: number) => {
  const dataDir = path.join(userDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ mode: 'server', port, [CONFIG_SECRET_FIELD]: TEST_PASSPHRASE }, null, 2),
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

const shoot = async (window: Page, name: string) => {
  // Dismiss any toasts (e.g. live cloud-status notifications) so they don't
  // overlay the capture. Best-effort — ignore if none are present.
  try {
    const closeButtons = window.locator('.toast-close');
    const count = await closeButtons.count();
    for (let i = 0; i < count; i += 1) {
      await closeButtons.first().click({ timeout: 1000 });
    }
  } catch {
    // No toasts, or they vanished mid-click — fine either way.
  }
  // Let layout/animations settle before capture.
  await window.waitForTimeout(750);
  await window.screenshot({ path: path.join(SHOTS_DIR, name), fullPage: false });
};

const goToTab = async (window: Page, testId: string, breadcrumbLabel: string) => {
  await window.getByTestId(testId).click();
  await expect(window.locator('.header-breadcrumb')).toContainText(`Relay / ${breadcrumbLabel}`);
};

const setAccentViaStorage = async (window: Page, accent: string) => {
  await window.evaluate((id) => {
    localStorage.setItem('relay-accent', id);
    globalThis.document.documentElement.setAttribute('data-accent', id);
  }, accent);
};

const seedData = async (port: number) => {
  const pb = await makePbClient(port);

  // --- Contacts (varied names/titles/phones) ---
  const contacts = [
    {
      name: 'Ada Lovelace',
      email: 'ada.lovelace@example.com',
      title: 'Principal Engineer',
      phone: '5550100001',
    },
    {
      name: 'Grace Hopper',
      email: 'grace.hopper@example.com',
      title: 'Rear Admiral, SRE',
      phone: '5550100002',
    },
    {
      name: 'Katherine Johnson',
      email: 'katherine.johnson@example.com',
      title: 'Trajectory Analyst',
      phone: '5550100003',
    },
    {
      name: 'Alan Turing',
      email: 'alan.turing@example.com',
      title: 'Cryptanalysis Lead',
      phone: '5550100004',
    },
    {
      name: 'Hedy Lamarr',
      email: 'hedy.lamarr@example.com',
      title: 'Spectrum Engineer',
      phone: '5550100005',
    },
    {
      name: 'Claude Shannon',
      email: 'claude.shannon@example.com',
      title: 'Information Theorist',
      phone: '5550100006',
    },
  ];
  for (const contact of contacts) {
    await pb.collection('contacts').create(contact, { requestKey: null });
  }

  // --- Servers ---
  const servers = [
    {
      name: 'prod-db-01',
      businessArea: 'Payments',
      lob: 'Core Banking',
      comment: 'Primary PostgreSQL cluster node',
      owner: 'Ada Lovelace',
      contact: 'ada.lovelace@example.com',
      os: 'RHEL 9',
    },
    {
      name: 'edge-proxy-12',
      businessArea: 'Platform',
      lob: 'Networking',
      comment: 'East coast edge proxy',
      owner: 'Grace Hopper',
      contact: 'grace.hopper@example.com',
      os: 'Ubuntu 24.04',
    },
    {
      name: 'batch-etl-07',
      businessArea: 'Analytics',
      lob: 'Data Platform',
      comment: 'Nightly ETL runner',
      owner: 'Alan Turing',
      contact: 'alan.turing@example.com',
      os: 'Windows Server 2022',
    },
  ];
  for (const server of servers) {
    await pb.collection('servers').create(server, { requestKey: null });
  }

  // --- On-call teams (oncall rows; teamId = lowercased team name) ---
  // Team 1: fully assigned (primary + secondary, contacts + time windows).
  const fullTeam = [
    {
      team: 'Database Reliability',
      teamId: 'database reliability',
      role: 'Primary',
      name: 'Ada Lovelace',
      contact: '5550100001',
      timeWindow: '',
      sortOrder: 0,
    },
    {
      team: 'Database Reliability',
      teamId: 'database reliability',
      role: 'Secondary',
      name: 'Grace Hopper',
      contact: '5550100002',
      timeWindow: '',
      sortOrder: 1,
    },
  ];
  // Team 2: standby-ish — primary assigned, standby row missing contact.
  const standbyTeam = [
    {
      team: 'Network Ops',
      teamId: 'network ops',
      role: 'Primary',
      name: 'Hedy Lamarr',
      contact: '5550100005',
      timeWindow: '',
      sortOrder: 0,
    },
    {
      team: 'Network Ops',
      teamId: 'network ops',
      role: 'Standby',
      name: 'Claude Shannon',
      contact: '',
      timeWindow: '',
      sortOrder: 1,
    },
  ];
  // Team 3: EMPTY — placeholder row with no personnel (no-coverage state).
  const emptyTeam = [
    {
      team: 'Payments Escalation',
      teamId: 'payments escalation',
      role: 'Primary',
      name: '',
      contact: '',
      timeWindow: '',
      sortOrder: 0,
    },
  ];
  for (const row of [...fullTeam, ...standbyTeam, ...emptyTeam]) {
    await pb.collection('oncall').create(row, { requestKey: null });
  }

  // --- Standalone notes with different category colors ---
  const notes = [
    {
      title: 'Failover Runbook',
      content: 'Promote replica, rotate credentials, update DNS. Validate with smoke suite.',
      color: 'amber',
      tags: ['runbook', 'database'],
      sortOrder: 0,
    },
    {
      title: 'Maintenance Window',
      content: 'Edge proxies patched every second Tuesday, 02:00-04:00 UTC.',
      color: 'blue',
      tags: ['maintenance'],
      sortOrder: 1,
    },
    {
      title: 'Escalation Contacts',
      content: 'Payments escalation currently unstaffed — see On-Call board.',
      color: 'red',
      tags: ['escalation', 'urgent'],
      sortOrder: 2,
    },
  ];
  for (const note of notes) {
    await pb.collection('standalone_notes').create(note, { requestKey: null });
  }

  // --- One alert history entry ---
  await pb.collection('alert_history').create(
    {
      severity: 'ISSUE',
      subject: 'Degraded latency on prod-db-01',
      bodyHtml: '<p>Elevated p99 latency observed on the primary database cluster.</p>',
      sender: 'relay@relay.app',
      recipient: 'oncall@example.com',
      pinned: false,
      label: 'Database',
    },
    { requestKey: null },
  );
};

test.describe('Redesign screenshot harness', () => {
  test('captures Accent Ink screenshots across tabs and accent schemes', async () => {
    test.setTimeout(8 * 60 * 1000);

    fs.mkdirSync(SHOTS_DIR, { recursive: true });

    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    const launchEnv = { ...process.env, NODE_ENV: 'test' };
    delete (launchEnv as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
    const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-shots-'));
    const pbPort = makePort();
    writeServerConfig(tempDataDir, pbPort);

    const electronApp = await electron.launch({
      args: [`--user-data-dir=${tempDataDir}`, mainEntry],
      env: launchEnv,
    });

    try {
      const window = await electronApp.firstWindow();
      await electronApp.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        mainWindow?.setSize(1920, 1080);
      });
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('sidebar-compose')).toBeVisible({ timeout: 30_000 });

      // Seed data through PocketBase, then reload so every tab starts hydrated.
      await seedData(pbPort);
      await window.reload();
      await window.waitForLoadState('domcontentloaded');
      await expect(window.getByTestId('sidebar-compose')).toBeVisible({ timeout: 30_000 });

      // Verify no sidebar nav label is ellipsized at 1920×1080.
      const truncated = await window.evaluate(() => {
        return [...globalThis.document.querySelectorAll('.sidebar-button-label')]
          .filter((el) => el.scrollWidth > el.clientWidth)
          .map((el) => el.textContent);
      });
      expect(truncated).toEqual([]);

      // Verify sidebar buttons are not clipped by parent flex container (≥ 100px wide).
      const buttonWidths = await window.evaluate(() => {
        return [...globalThis.document.querySelectorAll('.sidebar-button')].map((el) => {
          const rect = el.getBoundingClientRect();
          const label = el.querySelector('.sidebar-button-label');
          return { width: rect.width, label: label?.textContent };
        });
      });
      for (const btn of buttonWidths) {
        expect(btn.width).toBeGreaterThanOrEqual(100);
      }
      console.log('Sidebar button widths:', buttonWidths);

      // Default accent (red) for the tab tour.
      await setAccentViaStorage(window, 'red');

      // --- Compose ---
      await goToTab(window, 'sidebar-compose', 'Compose');
      await expect(window.getByRole('button', { name: 'DRAFT BRIDGE' })).toBeVisible();
      await shoot(window, 'compose.png');

      // --- On-Call ---
      await goToTab(window, 'sidebar-on-call', 'On-Call');
      await expect(window.getByRole('button', { name: 'ADD CARD' })).toBeVisible();
      await expect(
        window.locator('.team-card-body', { hasText: 'Database Reliability' }),
      ).toBeVisible();
      await expect(
        window.locator('.team-card-body', { hasText: 'Payments Escalation' }),
      ).toBeVisible();
      await shoot(window, 'oncall.png');

      // --- People ---
      await goToTab(window, 'sidebar-people', 'People');
      await expect(window.getByRole('button', { name: 'ADD CONTACT' })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('Grace Hopper');
      await shoot(window, 'people.png');

      // --- Servers ---
      await goToTab(window, 'sidebar-servers', 'Servers');
      await expect(window.getByRole('button', { name: 'ADD SERVER' })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('prod-db-01');
      await shoot(window, 'servers.png');

      // --- Alerts ---
      await goToTab(window, 'sidebar-alerts', 'Alerts');
      await shoot(window, 'alerts.png');

      // --- Notes ---
      await goToTab(window, 'sidebar-notes', 'Notes');
      await expect(window.locator('.tab-panel--active')).toContainText('Failover Runbook');
      await shoot(window, 'notes.png');

      // --- Cloud / Service Status ---
      await goToTab(window, 'sidebar-status', 'Service Status');
      await shoot(window, 'cloud-status.png');

      // --- Settings modal with accent picker ---
      await window.getByTestId('sidebar-settings').click();
      await expect(window.getByRole('radiogroup', { name: 'Accent color' })).toBeVisible();
      await shoot(window, 'settings-modal.png');
      await window.keyboard.press('Escape');
      await expect(window.getByRole('radiogroup', { name: 'Accent color' })).not.toBeVisible();

      // --- Accent matrix on the On-Call board (empty-team alarm visible) ---
      await goToTab(window, 'sidebar-on-call', 'On-Call');
      await expect(
        window.locator('.team-card-body', { hasText: 'Payments Escalation' }),
      ).toBeVisible();
      for (const accent of ['red', 'blue', 'green', 'pink', 'purple'] as const) {
        await setAccentViaStorage(window, accent);
        await expect
          .poll(() =>
            window.evaluate(() => globalThis.document.documentElement.getAttribute('data-accent')),
          )
          .toBe(accent);
        await shoot(window, `oncall-${accent}.png`);
      }

      // --- Kiosk popout window ---
      await setAccentViaStorage(window, 'red');
      try {
        const popoutPromise = electronApp.waitForEvent('window', { timeout: 20_000 });
        await window.getByRole('button', { name: 'Pop Out Board' }).click();
        const popout = await popoutPromise;
        await popout.waitForLoadState('domcontentloaded');
        await electronApp.evaluate(({ BrowserWindow }) => {
          const wins = BrowserWindow.getAllWindows();
          // Resize the most recently created window (the popout).
          wins[wins.length - 1]?.setSize(1920, 1080);
        });
        await expect(popout.locator('.popout-title')).toBeVisible({ timeout: 20_000 });
        await expect(popout.locator('body')).toContainText('Database Reliability');
        await shoot(popout, 'popout.png');
        await popout.close().catch(() => {});
      } catch (error) {
        console.warn('Popout capture skipped:', error);
      }

      // Reset accent to the default red before shutting down.
      await setAccentViaStorage(window, 'red');
    } finally {
      try {
        await electronApp.close();
      } catch {
        // Already closed.
      }
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
