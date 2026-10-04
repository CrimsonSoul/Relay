/**
 * Screenshot harness for the README preview set and design review.
 *
 * Launches the real Electron app in embedded-server mode, seeds demo data via the PocketBase
 * client, swaps the Radar and SDP main-process handlers for fixed demo replies, and captures
 * 1920x1080 screenshots of every tab plus Settings and the accent scheme set into
 * tmp/redesign-shots/.
 *
 * Not part of the default suite — run explicitly:
 *   RELAY_CAPTURE_SCREENSHOTS=1 npm run test:electron -- tests/e2e/redesign-screenshots.spec.ts
 */
import { _electron as electron, test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import PocketBase from 'pocketbase';
import { buildKnowledgePdfFixture } from '../fixtures/knowledgePdfFixtures';

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

  // Dismiss toasts (e.g. live cloud-status notifications) so they don't overlay the capture.
  // Queued toasts open as earlier ones close, so repeat until none remain; best-effort.
  const toasts = window.locator('.toast');
  for (let attempt = 0; attempt < 10 && (await toasts.count()) > 0; attempt += 1) {
    try {
      await window.locator('.toast[data-state="open"] .toast-close').first().click({
        timeout: 1000,
      });
    } catch {
      // Toast vanished mid-click or is not open yet - re-check on the next pass.
    }
    await window.waitForTimeout(300);
  }

  await window.waitForTimeout(250);
  await window.screenshot({ path: path.join(SHOTS_DIR, name), fullPage: false });
};

const goToTab = async (window: Page, testId: string) => {
  const destination = window.getByTestId(testId);
  await destination.click();
  await expect(destination).toHaveAttribute('aria-current', 'page');
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

/** Edges of a layout box; structural so it needs no DOM lib globals in this Node-linted spec. */
type LayoutBox = { left: number; right: number; top: number; bottom: number };

/**
 * Runs in the page: every on-call name that splits a word across lines, overlaps its role code or
 * phone, or is truncated. Module-level so `page.evaluate` can serialise it as-is.
 */
function collectOnCallRowProblems(): string[] {
  const overlaps = (a: LayoutBox, b: LayoutBox) =>
    a.left < b.right - 0.5 &&
    b.left < a.right - 0.5 &&
    a.top < b.bottom - 0.5 &&
    b.top < a.bottom - 0.5;
  // Words whose glyph boxes land on more than one line were split mid-word.
  const splitWords = (
    textNode: NonNullable<typeof globalThis.document.body.firstChild>,
  ): string[] =>
    Array.from((textNode.textContent ?? '').matchAll(/\S+/g)).flatMap((match) => {
      const range = globalThis.document.createRange();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, match.index + match[0].length);
      const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
      return lines.size > 1 ? [match[0]] : [];
    });
  return Array.from(globalThis.document.querySelectorAll('.team-row')).flatMap((row) => {
    const name = row.querySelector('.team-row-name');
    const code = row.querySelector('.team-row-role-code');
    const phone = row.querySelector('.team-row-phone');
    if (!name?.firstChild || !code || !phone) return [];
    const label = name.textContent?.trim() ?? '';
    const nameBox = name.getBoundingClientRect();
    const found = splitWords(name.firstChild).map((word) => `${label}: "${word}" breaks mid-word`);
    if (overlaps(code.getBoundingClientRect(), nameBox)) found.push(`${label}: overlaps role`);
    if (overlaps(phone.getBoundingClientRect(), nameBox)) found.push(`${label}: overlaps phone`);
    if (name.scrollWidth > name.clientWidth + 1) found.push(`${label}: truncated`);
    return found;
  });
}

/**
 * Layout contract for the glance-from-10-ft board: every name stays whole (no word split across
 * lines, nothing truncated) and never touches its role code or phone number.
 */
const expectLegibleOnCallRows = async (window: Page) => {
  expect(await window.evaluate(collectOnCallRowProblems)).toEqual([]);
};

type ElectronApp = Awaited<ReturnType<typeof electron.launch>>;

const COMPACT_TABS = [
  { id: 'sidebar-compose', shot: 'compose-compact.png' },
  { id: 'sidebar-alerts', shot: 'alerts-compact.png' },
  { id: 'sidebar-on-call', shot: 'oncall-compact.png' },
  { id: 'sidebar-status', shot: 'cloud-status-compact.png' },
  { id: 'sidebar-problems', shot: 'dynatrace-problems-compact.png' },
  { id: 'sidebar-knowledge', shot: 'knowledge-compact.png' },
  { id: 'sidebar-radar', shot: 'radar-compact.png' },
  { id: 'sidebar-settings', shot: 'settings-compact.png' },
] as const;

const resizeMainWindow = async (electronApp: ElectronApp, width: number, height: number) => {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
    },
    { width, height },
  );
};

const setApplicationZoom = async (electronApp: ElectronApp, factor: number) => {
  await electronApp.evaluate(({ BrowserWindow }, nextFactor) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(nextFactor);
  }, factor);
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor(),
      ),
    )
    .toBe(factor);
};

const expectTopLevelChrome = async (window: Page, hasToolbar: boolean) => {
  const activePanel = window.locator('.tab-panel--active');
  await expect(activePanel.locator('.tab-page-header')).toBeVisible();
  // Every top-level page names its source or scope in one quiet qualifier beside the title.
  await expect(activePanel.locator('.tab-page-header__subtitle')).toHaveCount(1);
  await expect(activePanel.locator('.tab-page-header__subtitle')).toBeVisible();
  // Help and Notifications are quiet ghost commands (icon + label) that never outrank page commands.
  const headerActions = window.locator('.header-actions .header-action');
  await expect(headerActions.first()).toBeVisible();
  await expect(
    window.locator('.header-actions .header-action:not(.tactile-button--ghost)'),
  ).toHaveCount(0);
  await expect(
    window.locator('.header-actions .header-action .tactile-button-icon svg'),
  ).toHaveCount(await headerActions.count());
  const toolbar = activePanel.locator('.tab-command-bar');
  if (!hasToolbar) {
    await expect(toolbar).toHaveCount(0);
    return;
  }

  await expect(toolbar).toHaveCount(1);
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute('aria-label', /\S/u);
  await expect
    .poll(() => toolbar.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      activePanel.evaluate((panel) => {
        const toolbar = panel.querySelector('.tab-command-bar');
        if (!(toolbar instanceof globalThis.HTMLElement)) return false;
        const panelBounds = panel.getBoundingClientRect();
        return Array.from(toolbar.querySelectorAll('button')).every((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left >= panelBounds.left - 1 && rect.right <= panelBounds.right + 1;
        });
      }),
    )
    .toBe(true);
};

const expectCompactComposeActionsAligned = async (window: Page) => {
  const copyRecipients = window.getByRole('button', { name: 'Copy Recipients' });
  const openTeamsDraft = window.getByRole('button', { name: 'New Teams Bridge' });
  const moreActions = window.getByRole('button', { name: 'More Compose Actions' });
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

// The NOC response commit must be on screen without scrolling the detail pane at compact size.
const expectProblemsCommitVisible = async (window: Page) => {
  const detail = window.locator('.tab-panel--active .dt-problems__detail');
  const primary = detail.locator('.dt-problems__primary-action');
  await expect(primary).toBeVisible();
  await detail.evaluate((pane) => pane.scrollTo({ top: 0 }));
  const paneBox = await detail.boundingBox();
  const primaryBox = await primary.boundingBox();
  expect(paneBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  if (!paneBox || !primaryBox) return;
  expect(primaryBox.y).toBeGreaterThanOrEqual(paneBox.y);
  expect(primaryBox.y + primaryBox.height).toBeLessThanOrEqual(paneBox.y + paneBox.height + 1);
  expect(primaryBox.x).toBeGreaterThanOrEqual(paneBox.x);
  expect(primaryBox.x + primaryBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);
};

/** At 1366×768 the whole rail fits: Settings sits fully inside the sidebar, the nav needs no
 *  scrolling, and no sidebar label is cut short. */
const expectSidebarWhole = async (window: Page) => {
  const geometry = await window.evaluate(() => {
    const sidebar = globalThis.document.querySelector('.sidebar')!.getBoundingClientRect();
    const settings = globalThis.document
      .querySelector('[data-testid="sidebar-settings"]')!
      .getBoundingClientRect();
    const nav = globalThis.document.querySelector('.sidebar-nav')!;
    const clippedLabels = [...globalThis.document.querySelectorAll('.sidebar-button-label')]
      .filter((label) => {
        const box = label.getBoundingClientRect();
        return (
          label.scrollWidth > label.clientWidth ||
          label.scrollHeight > label.clientHeight ||
          box.bottom > sidebar.bottom
        );
      })
      .map((label) => label.textContent);
    return {
      settingsBottom: settings.bottom,
      sidebarBottom: sidebar.bottom,
      navOverflow: nav.scrollHeight - nav.clientHeight,
      clippedLabels,
    };
  });
  expect(geometry.settingsBottom).toBeLessThanOrEqual(geometry.sidebarBottom);
  expect(geometry.navOverflow).toBeLessThanOrEqual(0);
  expect(geometry.clippedLabels).toEqual([]);
};

const captureCompactTabTour = async (window: Page, electronApp: ElectronApp) => {
  await resizeMainWindow(electronApp, 1366, 768);

  for (const tab of COMPACT_TABS) {
    await goToTab(window, tab.id);

    await expectSidebarWhole(window);
    if (tab.id === 'sidebar-compose') await expectCompactComposeActionsAligned(window);
    if (tab.id === 'sidebar-on-call') {
      await expectLegibleOnCallRows(window);
      await setOnCallFontScaleViaStorage(window, 150);
      await expect(window.locator('.oncall-display__scale')).toContainText('150%');
      await expectLegibleOnCallRows(window);
      await setOnCallFontScaleViaStorage(window, 100);
      await expect(window.locator('.oncall-display__scale')).toContainText('100%');
    }
    if (tab.id === 'sidebar-problems') await expectProblemsCommitVisible(window);
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

// Records a healthy sync so the Problems queue reads as live rather than a saved copy.
const recordHealthyDynatraceSync = async (pb: PocketBase, syncedAt: string) => {
  const sync = pb.collection('dynatrace_problem_sync');
  const record = {
    key: 'primary',
    state: 'ok',
    lastAttemptAt: syncedAt,
    lastSuccessAt: syncedAt,
    lastReconciledAt: syncedAt,
  };
  const existing = await sync.getList<{ id: string }>(1, 1, {
    filter: 'key = "primary"',
    requestKey: null,
  });
  if (existing.items[0]) await sync.update(existing.items[0].id, record, { requestKey: null });
  else await sync.create(record, { requestKey: null });
};

const WIKI_DOCUMENTS = [
  { category: 'Incident Response', title: 'Major Incident Bridge Checklist', pageCount: 4 },
  { category: 'Incident Response', title: 'Payment API Degradation Runbook', pageCount: 9 },
  { category: 'Database', title: 'PostgreSQL Failover Procedure', pageCount: 12 },
  { category: 'Network', title: 'DR Site VPN Tunnel Recovery', pageCount: 6 },
  { category: 'Network', title: 'Edge Proxy Certificate Rotation', pageCount: 3 },
] as const;

const seedWikiDocuments = async (pb: PocketBase) => {
  const timestamp = new Date().toISOString();
  const categories = new Map<string, string>();
  for (const name of new Set(WIKI_DOCUMENTS.map(({ category }) => category))) {
    const category = await pb.collection('knowledge_categories').create<{ id: string }>(
      {
        name,
        normalizedName: name.toLocaleLowerCase('en-US'),
        sortOrder: (categories.size + 1) * 100,
        systemKey: '',
        revision: 1,
      },
      { requestKey: null },
    );
    categories.set(name, category.id);
  }
  for (const { category, title, pageCount } of WIKI_DOCUMENTS) {
    const fileName = `${title}.pdf`;
    const bytes = buildKnowledgePdfFixture({ title, pageCount });
    const form = new FormData();
    form.set('sourceKey', `${category}/${fileName}`);
    form.set('category', category);
    form.set('categoryId', categories.get(category)!);
    form.set('documentType', 'sop');
    form.set('title', title);
    form.set('displayTitle', title);
    form.set('fileName', fileName);
    form.set('pdf', new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }), fileName);
    form.set('checksum', crypto.createHash('sha256').update(bytes).digest('hex'));
    form.set('byteSize', String(bytes.byteLength));
    form.set('pageCount', String(pageCount));
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

  // --- Saved bridge groups ---
  const groups = [
    {
      name: 'Payments Bridge',
      contacts: [
        'ada.lovelace@example.com',
        'grace.hopper@example.com',
        'katherine.johnson@example.com',
      ],
    },
    {
      name: 'Network Escalation',
      contacts: [
        'hedy.lamarr@example.com',
        'claude.shannon@example.com',
        'alan.turing@example.com',
      ],
    },
    { name: 'Database On-Call', contacts: ['ada.lovelace@example.com', 'alan.turing@example.com'] },
  ];
  for (const group of groups) {
    await pb.collection('bridge_groups').create(group, { requestKey: null });
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
        { id: 'HOST-SHOTS-1', type: 'HOST', name: 'checkout-web-01.prod.example.com' },
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
  await recordHealthyDynatraceSync(superuserPb, syncedAt);
  await seedWikiDocuments(superuserPb);
};

const radarClock = (time: number) => {
  const date = new Date(time);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${date.toLocaleTimeString('en-US')}`;
};

const demoRadarSnapshot = (now: number) => {
  const dispatcher = (name: string, tone: 'green' | 'yellow', queues: [string, number][]) => ({
    name,
    tone,
    lastScheduleDate: radarClock(now - 40_000),
    lastPubSubDate: radarClock(now - 25_000),
    queues: queues.map(([queue, depth]) => ({ name: queue, depth })),
  });
  return {
    color: 'yellow',
    dispatchers: [
      dispatcher('prod01', 'green', [['ORDER.SUBMIT.RETRY.QUEUE', 3]]),
      dispatcher('prod02', 'green', []),
      dispatcher('prod03', 'yellow', [
        ['PAYMENTS.SETTLEMENT.QUEUE', 418],
        ['TRANSACTION.MEMBERSHIPS.ERROR.QUEUE', 27],
      ]),
      dispatcher('prod04', 'green', [['LOYALTY.POINTS.QUEUE', 7]]),
    ],
    papa: [
      { name: 'READY', depth: 4 },
      { name: 'UNACKED', depth: 0 },
    ],
    metrics: [
      { label: 'Order API Counts', value: '6063', tone: 'green' },
      { label: 'Cardservices Requests (Last Hour)', value: '1482', tone: 'green' },
      { label: 'Store Sync Lag (Minutes)', value: '3', tone: 'green' },
      { label: 'EDW Daily Load Date Status', value: null, tone: 'green' },
    ],
    xcenter: { ok: 2000, pending: 14 },
    currentTime: radarClock(now - 15_000),
    lastUpdated: now - 15_000,
    signInRequired: false,
    error: null,
    failingSince: null,
  };
};

const demoTickets = (now: number) => {
  const minutes = 60_000;
  const ticket = (
    id: string,
    subject: string,
    fields: {
      status: string;
      priority: string;
      technician: string;
      requestType: string;
      category: string;
      age: number;
      idle: number;
      due: number | null;
    },
  ) => ({
    id,
    number: id,
    subject,
    status: fields.status,
    priority: fields.priority,
    group: 'NOC',
    technician: fields.technician,
    requestType: fields.requestType,
    category: fields.category,
    createdAt: now - fields.age * minutes,
    updatedAt: now - fields.idle * minutes,
    dueAt: fields.due === null ? null : now + fields.due * minutes,
  });
  const incident = { requestType: 'Incident' };
  return [
    ticket('48211', 'Checkout web returning 503 errors for some customers', {
      ...incident,
      status: 'In Progress',
      priority: 'High',
      technician: 'Ada Lovelace',
      category: 'Applications',
      age: 16,
      idle: 3,
      due: 44,
    }),
    ticket('48207', 'Payment API latency above 2 seconds at store registers', {
      ...incident,
      status: 'Open',
      priority: 'High',
      technician: 'Grace Hopper',
      category: 'Payments',
      age: 31,
      idle: 9,
      due: 89,
    }),
    ticket('48198', 'VPN tunnel to the DR site is flapping', {
      ...incident,
      status: 'On Hold',
      priority: 'Medium',
      technician: 'Hedy Lamarr',
      category: 'Network',
      age: 95,
      idle: 40,
      due: 180,
    }),
    ticket('48190', 'Disk usage at 91% on batch-etl-07', {
      ...incident,
      status: 'Open',
      priority: 'Medium',
      technician: 'Alan Turing',
      category: 'Servers',
      age: 140,
      idle: 70,
      due: 300,
    }),
    ticket('48176', 'New hire needs on-call bridge access', {
      requestType: 'Service Request',
      status: 'Open',
      priority: 'Low',
      technician: '',
      category: 'Access',
      age: 300,
      idle: 300,
      due: 1_440,
    }),
    ticket('48170', 'Label printer offline at Distribution Center 3', {
      ...incident,
      status: 'Open',
      priority: 'Low',
      technician: 'Claude Shannon',
      category: 'Hardware',
      age: 420,
      idle: 200,
      due: 1_200,
    }),
  ];
};

/**
 * Replaces the Radar poller and the SDP broker in the main process with fixed demo replies, so the
 * README shots show populated workspaces without a dashboard server or an SDP account.
 */
const installDemoProviders = async (electronApp: ElectronApp) => {
  const now = Date.now();
  await electronApp.evaluate(
    ({ BrowserWindow, ipcMain }, demo) => {
      ipcMain.removeHandler('radar:getSnapshot');
      ipcMain.handle('radar:getSnapshot', () => demo.radar);
      ipcMain.removeHandler('radar:refresh');
      ipcMain.handle('radar:refresh', () => demo.radar);
      // The real poller keeps broadcasting its failures; swap them for the demo board.
      for (const win of BrowserWindow.getAllWindows()) {
        const contents = win.webContents;
        const send = contents.send.bind(contents);
        contents.send = (channel: string, ...args: unknown[]) =>
          channel === 'radar:snapshotChanged' ? send(channel, demo.radar) : send(channel, ...args);
      }

      // One cumulative view, like the real broker: a reply without a queue page must not clear
      // the queue the renderer already shows.
      let view: Record<string, unknown> = {
        configured: true,
        status: 'connected',
        expiresAt: demo.now + 3_600_000,
      };
      const changes = (problemStart: number) => [
        {
          id: '2214',
          number: 'CHG-2214',
          title: 'Checkout web release 4.18 canary rollout',
          description: 'Roll checkout-web 4.18 to 10% of production traffic.',
          status: 'Completed',
          stage: 'Review',
          site: '',
          scheduledStart: problemStart - 20 * 60_000,
          scheduledEnd: problemStart + 40 * 60_000,
          assets: ['checkout-web-01.prod.example.com'],
          services: ['checkout-api'],
        },
      ];
      ipcMain.removeHandler('sdp:account');
      ipcMain.handle('sdp:account', (_event, command) => {
        switch (command.action) {
          case 'monitorQueues':
            return {
              success: true,
              data: {
                ...view,
                monitoring: { state: 'live', nextCheckAt: Date.now() + 30_000 },
                monitor: {
                  generation: 'readme-demo',
                  startedAt: demo.now,
                  fetchedAt: Date.now(),
                  truncated: false,
                  tickets: demo.tickets,
                },
              },
            };
          case 'readQueue':
            view = {
              ...view,
              queuePage: {
                ...(command.filters ? { filters: command.filters } : {}),
                queue: command.queue,
                page: command.page,
                hasMore: false,
                tickets: command.queue === 'NOC' ? demo.tickets : [],
              },
              snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60_000 },
            };
            break;
          case 'readChanges':
            return {
              success: true,
              data: {
                ...view,
                changesPage: { page: 0, hasMore: false, changes: changes(command.problemStart) },
              },
            };
          case 'verifyWorkflowTicket':
            return { success: true, data: { ...view, workflowTicketMatch: false } };
        }
        return { success: true, data: view };
      });
    },
    { now, radar: demoRadarSnapshot(now), tickets: demoTickets(now) },
  );
};

test.describe('Redesign screenshot harness', () => {
  // This manual artifact generator is intentionally excluded from normal regression gates.
  test.skip(process.env.RELAY_CAPTURE_SCREENSHOTS !== '1', 'Explicit screenshot refresh only');

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

      // Seed data through PocketBase and install the demo Radar/SDP providers, then reload so
      // every tab starts hydrated.
      await seedData(pbPort);
      await installDemoProviders(electronApp);
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
      await goToTab(window, 'sidebar-compose');
      await expectTopLevelChrome(window, true);
      await expect(window.getByRole('button', { name: 'New Teams Bridge' })).toBeVisible();
      const paymentsBridge = window.getByRole('button', { name: /^Payments Bridge group/ });
      await paymentsBridge.click();
      await expect(paymentsBridge).toHaveAttribute('aria-pressed', 'true');
      await expect(window.locator('.tab-panel--active')).toContainText('Katherine Johnson');
      await shoot(window, 'compose.png');

      if (CAPTURE_ON_CALL) {
        // --- On-Call ---
        await goToTab(window, 'sidebar-on-call');
        await expectTopLevelChrome(window, true);
        await expect(window.getByRole('button', { name: 'Add Team' })).toBeVisible();
        await expect(
          window.locator('.team-card-body', { hasText: 'Database Reliability' }),
        ).toBeVisible();
        await expect(
          window.locator('.team-card-body', { hasText: 'Payments Escalation' }),
        ).toBeVisible();
        await expectLegibleOnCallRows(window);
        await shoot(window, 'oncall.png');
        await setOnCallFontScaleViaStorage(window, 150);
        await expect(window.locator('.oncall-display__scale')).toContainText('150%');
        await expectLegibleOnCallRows(window);
        await shoot(window, 'oncall-150.png');
        await setOnCallFontScaleViaStorage(window, 100);
        await expect(window.locator('.oncall-display__scale')).toContainText('100%');

        // Browser zoom contract: the busiest command row must stack without clipping.
        try {
          await setApplicationZoom(electronApp, 1.5);
          await expectTopLevelChrome(window, true);
          await shoot(window, 'oncall-browser-zoom-150.png');
        } finally {
          await setApplicationZoom(electronApp, 1);
        }

        // --- Toast (trigger via Copy All; raw capture — shoot() would dismiss it) ---
        await window.getByRole('button', { name: 'Copy All' }).click();
        await expect(window.locator('.toast')).toBeVisible();
        await window.waitForTimeout(400);
        await window.screenshot({ path: path.join(SHOTS_DIR, 'toast.png'), fullPage: false });
      }

      // --- Knowledge workspace ---
      await goToTab(window, 'sidebar-knowledge');
      await expectTopLevelChrome(window, false);
      await expect(window.getByRole('button', { name: /Open Wiki/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /Open Contacts/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /Open Servers/ })).toBeVisible();
      await shoot(window, 'knowledge.png');

      // --- Wiki ---
      await window.getByRole('button', { name: /Open Wiki/ }).click();
      await expect(window.getByRole('heading', { name: 'Wiki', exact: true })).toBeVisible();
      await shoot(window, 'wiki.png');
      await window.getByRole('button', { name: 'Knowledge home' }).click();

      // --- Contacts ---
      await window.getByRole('button', { name: /Open Contacts/ }).click();
      await expect(window.getByRole('button', { name: 'Add Contact', exact: true })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('Grace Hopper');
      await shoot(window, 'contacts.png');
      await window.getByRole('button', { name: 'Knowledge home' }).click();

      // --- Servers ---
      await window.getByRole('button', { name: /Open Servers/ }).click();
      await expect(window.getByRole('button', { name: 'Add Server', exact: true })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('prod-db-01');
      await shoot(window, 'servers.png');
      // Knowledge reopens its last destination; return home so the compact tour captures Home.
      await window.getByRole('button', { name: 'Knowledge home' }).click();

      // --- Alerts ---
      await goToTab(window, 'sidebar-alerts');
      await expectTopLevelChrome(window, true);
      const alertsPanel = window.locator('.tab-panel--active');
      await alertsPanel.locator('.alerts-sev-btn[data-sev="ISSUE"]').click();
      await alertsPanel
        .getByLabel('Subject', { exact: true })
        .fill('Checkout errors for some online customers');
      await alertsPanel.getByRole('textbox', { name: /body/i }).click();
      await window.keyboard.type(
        'Some customers see errors at checkout. Store registers are not affected. ' +
          'The NOC bridge is open and the next update is due at the top of the hour.',
      );
      await shoot(window, 'alerts.png');

      // --- Alert history modal (seeded with one ISSUE entry) ---
      await window.getByRole('button', { name: 'History' }).click();
      await expect(window.locator('.alert-history-content')).toBeVisible();
      await expect(window.locator('.alert-history-entry').first()).toBeVisible();
      await shoot(window, 'alert-history.png');
      await window.keyboard.press('Escape');
      await expect(window.locator('.alert-history-content')).not.toBeVisible();

      // --- Cloud / Service Status ---
      await goToTab(window, 'sidebar-status');
      await expectTopLevelChrome(window, true);
      await shoot(window, 'cloud-status.png');

      // --- Dynatrace Problems ---
      await goToTab(window, 'sidebar-problems');
      await expectTopLevelChrome(window, true);
      await expect(window.locator('.tab-panel--active')).toContainText(
        'Checkout service availability below SLO',
      );
      const relatedChanges = window.getByRole('region', { name: 'Related SDP changes' });
      await expect(relatedChanges).toContainText('1 match');
      await relatedChanges.locator('summary').filter({ hasText: 'Possible changes' }).click();
      await expect(relatedChanges.getByText(/Systems & time match/)).toBeVisible();
      await shoot(window, 'dynatrace-problems.png');

      // --- Dispatcher Radar ---
      await goToTab(window, 'sidebar-radar');
      await expectTopLevelChrome(window, true);
      await expect(window.getByRole('heading', { name: 'Radar', exact: true })).toBeVisible();
      await expect(window.locator('.tab-panel--active')).toContainText('prod03');
      await shoot(window, 'radar.png');

      // --- Tickets (demo SDP broker) ---
      await goToTab(window, 'sidebar-tickets');
      await window.getByRole('button', { name: 'NOC', exact: true }).click();
      await expect(window.getByRole('button', { name: /Open ticket 48211/ })).toBeVisible();
      await shoot(window, 'tickets.png');
      await expect(window.getByRole('button', { name: /Open ticket 48211/ })).toBeVisible();

      // --- Settings tab ---
      await goToTab(window, 'sidebar-settings');
      await expect(window.getByRole('radiogroup', { name: 'Accent color' })).toBeVisible();
      await expectSettingsBottomGutter(window);
      await shoot(window, 'settings-appearance.png');

      // Keep-awake is Windows-only; Settings hides the Workstation tab elsewhere.
      if (process.platform === 'win32') {
        await window.getByRole('tab', { name: 'Workstation' }).click();
        await expect(
          window.getByRole('switch', { name: 'Keep this PC awake while Relay is running' }),
        ).toBeVisible();
        await shoot(window, 'settings-workstation.png');
      }

      await window.getByRole('tab', { name: 'Relay Data' }).click();
      await expect(window.getByRole('heading', { name: 'Relay connection' })).toBeVisible();
      await shoot(window, 'settings-relay-data.png');

      // --- Data Manager modal (opened from Settings) ---
      await window.getByRole('button', { name: 'Open Data Manager…' }).click();
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
        await goToTab(window, 'sidebar-on-call');
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
