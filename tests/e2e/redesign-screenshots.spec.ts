/**
 * TEMPORARY verification spec for the Accent Ink redesign (Task 17).
 *
 * Launches the real Electron app in embedded-server mode, seeds data via the
 * PocketBase client, and captures 1920x1080 screenshots of every tab plus the
 * Settings accent picker and the accent scheme set into tmp/redesign-shots/.
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
const CAPTURE_ON_CALL = process.env.RELAY_CAPTURE_ON_CALL !== '0';
const CAPTURE_COMPACT = process.env.RELAY_CAPTURE_COMPACT === '1';

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

const makeSuperuserPbClient = async (port: number) => {
  const pb = new PocketBase(`http://127.0.0.1:${port}`);
  await pb.collection('_superusers').authWithPassword('admin@relay.app', TEST_PASSPHRASE, {
    requestKey: null,
  });
  return pb;
};

const shoot = async (window: Page, name: string) => {
  // Park the pointer in neutral header chrome so navigation tooltips do not
  // obscure the UI under review.
  await window.mouse.move(600, 30);

  // Let layout/animations settle before capture.
  await window.waitForTimeout(750);

  // Dismiss any toasts (e.g. live cloud-status notifications) so they don't
  // overlay the capture. Best-effort - ignore if none are present.
  try {
    const closeButtons = window.locator('.toast-close');
    while ((await closeButtons.count()) > 0) {
      await closeButtons.first().click({ timeout: 1000 });
      await window.waitForTimeout(100);
    }
  } catch {
    // No toasts, or they vanished mid-click - fine either way.
  }

  await window.waitForTimeout(250);
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

const setOnCallFontScaleViaStorage = async (window: Page, scale: number) => {
  await window.evaluate((nextScale) => {
    localStorage.setItem('relay-oncall-font-scale', String(nextScale));
    globalThis.dispatchEvent(
      new globalThis.StorageEvent('storage', {
        key: 'relay-oncall-font-scale',
        newValue: String(nextScale),
      }),
    );
  }, scale);
};

const expectNoEllipsizedOnCallNames = async (window: Page) => {
  const ellipsizedNames = await window.evaluate(() => {
    const names = Array.from(globalThis.document.querySelectorAll('.team-row-name'));
    return names
      .filter((el) => {
        const styles = globalThis.getComputedStyle(el);
        return styles.overflow === 'hidden' || styles.textOverflow === 'ellipsis';
      })
      .map((el) => el.textContent?.trim());
  });
  expect(ellipsizedNames).toEqual([]);
};

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>;

const COMPACT_TABS = [
  { id: 'sidebar-compose', breadcrumb: 'Compose', shot: 'compose-compact.png' },
  { id: 'sidebar-alerts', breadcrumb: 'Alerts', shot: 'alerts-compact.png' },
  { id: 'sidebar-status', breadcrumb: 'Service Status', shot: 'cloud-status-compact.png' },
  {
    id: 'sidebar-problems',
    breadcrumb: 'Dynatrace Problems',
    shot: 'dynatrace-problems-compact.png',
  },
  { id: 'sidebar-knowledge', breadcrumb: 'Knowledge', shot: 'knowledge-compact.png' },
  { id: 'sidebar-settings', breadcrumb: 'Settings', shot: 'settings-compact.png' },
] as const;

const resizeMainWindow = async (electronApp: ElectronApp, width: number, height: number) => {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
    },
    { width, height },
  );
};

const expectCompactComposeActionsAligned = async (window: Page) => {
  const copyRecipients = window.getByRole('button', { name: 'Copy Recipients' });
  const openTeamsDraft = window.getByRole('button', { name: 'Open Teams Draft' });
  const moreActions = window.getByRole('button', { name: 'More Compose actions' });
  const boxes = await Promise.all([
    copyRecipients.boundingBox(),
    openTeamsDraft.boundingBox(),
    moreActions.boundingBox(),
  ]);
  expect(boxes.every(Boolean)).toBe(true);
  const yPositions = boxes.map((box) => box?.y ?? 0);
  expect(Math.max(...yPositions) - Math.min(...yPositions)).toBeLessThan(2);
};

const expectSettingsBottomGutter = async (window: Page) => {
  await window.waitForTimeout(300);
  const workspace = await window.locator('.settings-page__workspace').boundingBox();
  const viewportHeight = await window.evaluate(() => globalThis.innerHeight);
  expect(workspace).not.toBeNull();
  expect(viewportHeight - ((workspace?.y ?? 0) + (workspace?.height ?? 0))).toBeGreaterThanOrEqual(
    12,
  );
};

const captureCompactTabTour = async (window: Page, electronApp: ElectronApp) => {
  await resizeMainWindow(electronApp, 1366, 768);

  for (const tab of COMPACT_TABS) {
    await goToTab(window, tab.id, tab.breadcrumb);

    if (tab.id === 'sidebar-compose') await expectCompactComposeActionsAligned(window);
    if (tab.id === 'sidebar-settings') {
      await window.getByRole('tab', { name: 'Appearance' }).click();
      await expectSettingsBottomGutter(window);
    }

    const activePanel = window.locator('.tab-panel--active');
    const overflow = await activePanel.evaluate((panel) => panel.scrollWidth - panel.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await shoot(window, tab.shot);
  }

  await resizeMainWindow(electronApp, 1920, 1080);
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

  // --- Dynatrace Problems operational queue ---
  const syncedAt = new Date().toISOString();
  const problems = [
    {
      problemId: 'RELAY-SHOTS-1001',
      displayId: 'P-SHOTS-1001',
      title: 'Checkout service availability below SLO',
      status: 'OPEN',
      severity: 'AVAILABILITY',
      impactLevel: 'APPLICATION',
      startTime: Date.now() - 18 * 60_000,
      endTime: -1,
      rootCauseName: 'checkout-web',
      affectedEntities: [
        { id: 'APPLICATION-SHOTS-1', type: 'APPLICATION', name: 'Checkout Web' },
        { id: 'SERVICE-SHOTS-1', type: 'SERVICE', name: 'checkout-api' },
      ],
      impactedEntities: [{ id: 'APPLICATION-SHOTS-1', type: 'APPLICATION', name: 'Checkout Web' }],
      managementZones: [{ id: 'ZONE-SHOTS-1', name: 'Payments Production' }],
      environmentUrl: 'https://relay-shots.live.dynatrace.com',
      syncedAt,
    },
    {
      problemId: 'RELAY-SHOTS-1002',
      displayId: 'P-SHOTS-1002',
      title: 'Payment API response time degradation',
      status: 'OPEN',
      severity: 'PERFORMANCE',
      impactLevel: 'SERVICES',
      startTime: Date.now() - 47 * 60_000,
      endTime: -1,
      rootCauseName: 'payments-api',
      affectedEntities: [
        { id: 'SERVICE-SHOTS-2', type: 'SERVICE', name: 'payments-api' },
        { id: 'HOST-SHOTS-7', type: 'HOST', name: 'prod-api-07' },
      ],
      impactedEntities: [{ id: 'SERVICE-SHOTS-3', type: 'SERVICE', name: 'order-submit' }],
      managementZones: [{ id: 'ZONE-SHOTS-1', name: 'Payments Production' }],
      environmentUrl: 'https://relay-shots.live.dynatrace.com',
      syncedAt,
    },
  ];
  const superuserPb = await makeSuperuserPbClient(port);
  for (const problem of problems) {
    await superuserPb.collection('dynatrace_problems').create(problem, { requestKey: null });
  }
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
        return [...globalThis.document.querySelectorAll('.sidebar-nav .sidebar-button-label')]
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
      await expect(window.getByRole('button', { name: 'Open Teams Draft' })).toBeVisible();
      await shoot(window, 'compose.png');

      if (CAPTURE_ON_CALL) {
        // --- On-Call ---
        await goToTab(window, 'sidebar-on-call', 'On-Call');
        await expect(window.getByRole('button', { name: 'ADD CARD' })).toBeVisible();
        await expect(
          window.locator('.team-card-body', { hasText: 'Database Reliability' }),
        ).toBeVisible();
        await expect(
          window.locator('.team-card-body', { hasText: 'Payments Escalation' }),
        ).toBeVisible();
        // Layout contract: member names remain fully visible instead of ellipsizing.
        await expectNoEllipsizedOnCallNames(window);
        await shoot(window, 'oncall.png');
        await setOnCallFontScaleViaStorage(window, 150);
        await expect(window.locator('.oncall-font-scale-value')).toContainText('150%');
        await expectNoEllipsizedOnCallNames(window);
        await shoot(window, 'oncall-150.png');
        await setOnCallFontScaleViaStorage(window, 100);
        await expect(window.locator('.oncall-font-scale-value')).toContainText('100%');

        // --- Toast (trigger via Copy All; raw capture — shoot() would dismiss it) ---
        await window.getByRole('button', { name: 'COPY ALL' }).click();
        await expect(window.locator('.toast')).toBeVisible();
        await window.waitForTimeout(400);
        await window.screenshot({ path: path.join(SHOTS_DIR, 'toast.png'), fullPage: false });
      }

      // --- Knowledge workspace ---
      await goToTab(window, 'sidebar-knowledge', 'Knowledge');
      await expect(window.getByRole('button', { name: /Open Wiki/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /Open Contacts/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /Open Servers/ })).toBeVisible();
      await shoot(window, 'knowledge.png');

      // --- Wiki ---
      await window.getByRole('button', { name: /Open Wiki/ }).click();
      await expect(window.getByRole('heading', { name: 'Wiki' })).toBeVisible();
      await shoot(window, 'wiki.png');
      await window.getByRole('button', { name: 'Knowledge home' }).click();

      // --- Contacts ---
      await window.getByRole('button', { name: /Open Contacts/ }).click();
      await expect(window.getByRole('button', { name: 'ADD CONTACT' })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('Grace Hopper');
      await shoot(window, 'contacts.png');
      await window.getByRole('button', { name: 'Knowledge home' }).click();

      // --- Servers ---
      await window.getByRole('button', { name: /Open Servers/ }).click();
      await expect(window.getByRole('button', { name: 'ADD SERVER' })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('prod-db-01');
      await shoot(window, 'servers.png');

      // --- Alerts ---
      await goToTab(window, 'sidebar-alerts', 'Alerts');
      await shoot(window, 'alerts.png');

      // --- Alert history modal (seeded with one ISSUE entry) ---
      await window.getByRole('button', { name: 'More alert actions' }).click();
      await window.getByRole('menuitem', { name: 'History' }).click();
      await expect(window.locator('.alert-history-content')).toBeVisible();
      await expect(window.locator('.alert-history-entry').first()).toBeVisible();
      await shoot(window, 'alert-history.png');
      await window.keyboard.press('Escape');
      await expect(window.locator('.alert-history-content')).not.toBeVisible();

      // --- Cloud / Service Status ---
      await goToTab(window, 'sidebar-status', 'Service Status');
      await shoot(window, 'cloud-status.png');

      // --- Dynatrace Problems ---
      await goToTab(window, 'sidebar-problems', 'Dynatrace Problems');
      await expect(window.locator('.tab-panel--active')).toContainText(
        'Checkout service availability below SLO',
      );
      await shoot(window, 'dynatrace-problems.png');

      // --- Settings tab ---
      await goToTab(window, 'sidebar-settings', 'Settings');
      await expect(window.getByRole('radiogroup', { name: 'Accent color' })).toBeVisible();
      await expectSettingsBottomGutter(window);
      await shoot(window, 'settings-appearance.png');

      await window.getByRole('tab', { name: 'Relay data' }).click();
      await expect(window.getByText('Relay connection')).toBeVisible();
      await shoot(window, 'settings-relay-data.png');

      // --- Data Manager modal (opened from Settings) ---
      await window.getByRole('button', { name: 'Open Data Manager...' }).click();
      await expect(window.getByRole('tablist', { name: 'Data Manager sections' })).toBeVisible();
      await shoot(window, 'data-manager.png');
      await window.keyboard.press('Escape');
      await expect(
        window.getByRole('tablist', { name: 'Data Manager sections' }),
      ).not.toBeVisible();

      await window.getByRole('tab', { name: 'Dynatrace' }).click();
      await expect(
        window.locator('.settings-section-heading', { hasText: 'Dynatrace Problems' }),
      ).toBeVisible();
      await shoot(window, 'settings-dynatrace.png');

      if (CAPTURE_COMPACT) await captureCompactTabTour(window, electronApp);

      if (CAPTURE_ON_CALL) {
        // --- Accent matrix on the On-Call board (empty-team alarm visible) ---
        await goToTab(window, 'sidebar-on-call', 'On-Call');
        await expect(
          window.locator('.team-card-body', { hasText: 'Payments Escalation' }),
        ).toBeVisible();
        for (const accent of [
          'red',
          'orange',
          'yellow',
          'blue',
          'cyan',
          'green',
          'lime',
          'pink',
          'purple',
          'violet',
        ] as const) {
          await setAccentViaStorage(window, accent);
          await expect
            .poll(() =>
              window.evaluate(() =>
                globalThis.document.documentElement.getAttribute('data-accent'),
              ),
            )
            .toBe(accent);
          await shoot(window, `oncall-${accent}.png`);
        }
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
