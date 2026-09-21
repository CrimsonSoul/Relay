import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import PocketBase from 'pocketbase';

test('SDP change correlation explains automatic and suggested relationships without provider writes', async ({
  playwright,
}, testInfo) => {
  test.setTimeout(90000);
  const root = mkdtempSync(join(tmpdir(), 'relay-change-e2e-'));
  const port = 20000 + randomInt(20000);
  const password = `synthetic-${randomUUID()}`;
  mkdirSync(join(root, 'data'));
  writeFileSync(
    join(root, 'data/config.json'),
    JSON.stringify({ mode: 'server', port, secret: password }),
  );
  const env = { ...process.env, NODE_ENV: 'test' };
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  const app = await playwright._electron.launch({
    args: [`--user-data-dir=${root}`, join(process.cwd(), 'dist/main/index.js')],
    env,
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1500, 1000),
    );
    await expect(page.getByTestId('sidebar-problems')).toBeVisible({ timeout: 30000 });
    const startTime = Date.now();
    const admin = new PocketBase(`http://127.0.0.1:${port}`);
    await admin.collection('_superusers').authWithPassword('admin@relay.app', password);
    await admin.collection('dynatrace_problems').create({
      problemId: 'CHANGE-TEST-1',
      displayId: 'P-CHANGE-1',
      title: 'Synthetic database unavailable',
      notificationTitle: 'Synthetic database unavailable',
      notificationStatus: 'OPEN',
      notificationUpdatedAt: startTime,
      status: 'OPEN',
      severity: 'AVAILABILITY',
      impactLevel: 'INFRASTRUCTURE',
      rootCauseName: 'db01.prod.test',
      affectedEntities: [{ id: 'HOST-1', type: 'host', name: 'db01.prod.test' }],
      impactedEntities: [],
      managementZones: [],
      startTime,
      endTime: -1,
      environmentUrl: 'https://synthetic.live.dynatrace.com',
      syncedAt: new Date().toISOString(),
    });
    await app.evaluate(({ ipcMain }, start) => {
      ipcMain.removeHandler('sdp:account');
      ipcMain.handle('sdp:account', (_event, command) => {
        const view = { configured: true, status: 'connected', expiresAt: start + 3600000 };
        if (command.action === 'status') return { success: true, data: view };
        if (command.action === 'monitorQueues')
          return {
            success: true,
            data: {
              ...view,
              monitoring: { state: 'live', nextCheckAt: Date.now() + 30000 },
              monitor: {
                generation: 'synthetic',
                fetchedAt: Date.now(),
                startedAt: start,
                truncated: false,
                tickets: [
                  {
                    id: '123',
                    number: '101',
                    subject: 'Synthetic database unavailable',
                    status: 'Open',
                    priority: 'Low',
                    group: 'NOC',
                    technician: '',
                    createdAt: start,
                    dueAt: null,
                  },
                ],
              },
            },
          };
        if (command.action === 'verifyWorkflowTicket')
          return {
            success: true,
            data: {
              ...view,
              workflowTicketMatch:
                command.id === '123' &&
                command.problemId === 'CHANGE-TEST-1' &&
                command.environment === 'https://synthetic.live.dynatrace.com',
            },
          };
        if (command.action !== 'readChanges') throw new Error('Unexpected provider action');
        const change = {
          id: '1',
          number: 'CH 101',
          title: 'Synthetic database patching',
          description: '',
          status: 'In progress',
          stage: 'Implementation',
          site: '',
          scheduledStart: start - 3600000,
          scheduledEnd: start + 3600000,
          assets: ['db01.prod.test'],
          services: [],
        };
        return {
          success: true,
          data: {
            ...view,
            changesPage: {
              page: 0,
              hasMore: false,
              changes: [
                change,
                {
                  ...change,
                  id: '2',
                  number: 'CH 102',
                  title: 'Synthetic restart request',
                  assets: [],
                  description: 'Restart db01.prod.test',
                },
              ],
            },
          },
        };
      });
    }, startTime);
    await page.getByTestId('sidebar-problems').click();
    await page.getByRole('button', { name: /Synthetic database unavailable/ }).click();
    const changes = page.getByRole('region', { name: 'Related SDP changes' });
    await expect(changes.getByText('Systems & time match')).toBeHidden();
    await changes.locator('summary').filter({ hasText: 'Possible changes' }).focus();
    await page.keyboard.press('Enter');
    await expect(changes.getByText(/Systems & time match/)).toBeVisible();
    await changes.getByText('CH 101 — Synthetic database patching', { exact: true }).click();
    await expect(changes.getByText(/Possible match/)).toBeVisible();
    await expect(changes.getByText('Exact fully qualified hostname')).toBeVisible();
    await changes.getByRole('button', { name: 'Mark relevant' }).first().click();
    await expect(changes.getByText(/Marked relevant/)).toBeVisible();
    await changes.getByText('CH 102 — Synthetic restart request', { exact: true }).click();
    await changes.getByRole('button', { name: 'Dismiss', exact: true }).last().click();
    await expect(changes.getByText(/Dismissed/)).toBeVisible();
    const linkedTickets = page.getByRole('region', { name: 'Linked SDP tickets' });
    await expect(linkedTickets.getByRole('button', { name: 'Ticket 101' })).toBeVisible({
      timeout: 15000,
    });
    const savedLink = await admin
      .collection('relay_sdp_links')
      .getFirstListItem('ticketId = "123"');
    expect(savedLink.problemId).toBe('CHANGE-TEST-1');
    await admin.collection('relay_sdp_links').update(savedLink.id, { suppressed: true });
    await expect(linkedTickets.getByRole('button', { name: 'Ticket 101' })).toHaveCount(0);
    // A fresh renderer/session reads the shared suppression instead of recreating the link.
    await page.reload();
    await expect(page.getByTestId('sidebar-problems')).toBeVisible();
    await page.getByTestId('sidebar-problems').click();
    await page.getByRole('button', { name: /Synthetic database unavailable/ }).click();
    await expect
      .poll(async () => (await admin.collection('relay_sdp_links').getFullList()).length)
      .toBe(1);
    expect((await admin.collection('relay_sdp_links').getOne(savedLink.id)).suppressed).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('problems-simplified.png') });
    await changes.getByText('Possible changes', { exact: true }).click();
    await changes.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('sdp-change-correlation.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 900));
    await page.mouse.move(750, 450);
    await expect
      .poll(() =>
        page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeLessThan(100);
    await changes.scrollIntoViewIfNeeded();
    await expect
      .poll(() => changes.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('problem-controls-narrow.png') });
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
