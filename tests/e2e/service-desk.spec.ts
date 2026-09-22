import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import PocketBase from 'pocketbase';

test('live ticket shell, detail, major incident confirmation and no demo controls', async ({
  playwright,
}, testInfo) => {
  test.setTimeout(150000);
  const root = mkdtempSync(join(tmpdir(), 'relay-ticket-e2e-'));
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
    page.on('pageerror', (error) => console.error('Ticket renderer:', error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(message.text());
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1500, 1000),
    );
    await expect(page.getByTestId('sidebar-compose')).toBeVisible({ timeout: 30000 });
    const admin = new PocketBase(`http://127.0.0.1:${port}`);
    await admin.collection('_superusers').authWithPassword('admin@relay.app', password);
    await admin.collection('dynatrace_problems').create({
      problemId: 'SYNTHETIC-1001',
      displayId: 'P-1001',
      title: 'Synthetic checkout outage',
      status: 'OPEN',
      severity: 'AVAILABILITY',
      impactLevel: 'APPLICATION',
      rootCauseName: 'synthetic-service',
      affectedEntities: [],
      impactedEntities: [],
      managementZones: [],
      startTime: Date.now(),
      endTime: -1,
      environmentUrl: 'https://synthetic.live.dynatrace.com',
      syncedAt: new Date().toISOString(),
    });
    await page.getByTestId('sidebar-tickets').click();
    await page.getByRole('button', { name: 'Connect work account', exact: true }).click();
    const accountDialog = page.getByRole('dialog', { name: 'Your SDP connection' });
    const protectedStorage = await app.evaluate(
      ({ safeStorage }) =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    );
    if (protectedStorage) {
      await expect(accountDialog.getByText(/one-time setup by an administrator/)).toBeVisible();
    } else {
      // Headless Linux has no keyring: verify the real storage refusal before injecting fixtures.
      await expect(accountDialog.getByRole('alert')).toHaveText(
        'SDP could not complete this action. Check your connection, account permissions, and sign-in status.',
      );
      expect(existsSync(join(root, 'sdp-server'))).toBe(false);
    }
    await expect(accountDialog.getByLabel('Client secret', { exact: true })).toHaveCount(0);
    await accountDialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Live SDP queues' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Refresh queue', exact: true })).toHaveCount(0);
    // Exercise real table geometry and the detail dialog with a synthetic provider reply.
    await app.evaluate(({ ipcMain }) => {
      let view: Record<string, unknown> = { configured: true, status: 'connected' };
      (globalThis as { refreshSdpQueueForTest?: () => void }).refreshSdpQueueForTest = () => {
        view = {
          ...view,
          queuePage: {
            queue: 'NOC',
            page: 0,
            hasMore: false,
            tickets: [
              {
                id: '124',
                number: '810130',
                subject: 'Automatically arrived ticket',
                status: 'Open',
                priority: 'Low',
                group: 'NOC',
                technician: 'Example operator',
                createdAt: Date.now(),
                dueAt: null,
              },
            ],
          },
          snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
        };
      };
      (globalThis as { replySdpForTest?: () => void }).replySdpForTest = () => {
        const queuePage = view.queuePage as { tickets: Record<string, unknown>[] };
        const row = {
          ...queuePage.tickets[0],
          replyState: 'ready',
          replyUnread: true,
          lastReply: {
            id: '457',
            author: 'Example requester',
            senderRole: 'requester',
            at: Date.now(),
          },
          replyEventId: '457',
        };
        view = { ...view, queuePage: { ...queuePage, tickets: [row] }, replyActivity: row };
      };
      let notificationTicket: Record<string, unknown> | undefined;
      (globalThis as { addSdpNotificationForTest?: () => void }).addSdpNotificationForTest = () => {
        notificationTicket = {
          id: '125',
          number: '810131',
          subject: 'Background ticket alert',
          group: 'SOX',
          status: 'Open',
          priority: 'Low',
          technician: 'Example operator',
          createdAt: Date.now(),
          dueAt: null,
        };
      };
      const monitorReply = (enabled?: boolean) => ({
        success: true,
        data: {
          configured: true,
          status: 'connected',
          monitoring: {
            state: enabled === false ? 'off' : 'live',
            nextCheckAt: Date.now() + 30000,
          },
          monitor: {
            generation: 'synthetic-notifications',
            fetchedAt: Date.now(),
            truncated: false,
            tickets: notificationTicket ? [notificationTicket] : [],
          },
        },
      });
      const notificationSummary = (id: string) =>
        id === '125' ? { replyActivity: notificationTicket } : {};
      ipcMain.removeHandler('sdp:account');
      ipcMain.handle('sdp:account', (_event, command) => {
        if (command.action === 'monitorQueues') return monitorReply(command.enabled);
        if (command.action === 'prepareChange')
          view = {
            ...view,
            review: {
              confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
              expiresAt: Date.now() + 300000,
              mutation: command.mutation,
            },
          };
        if (command.action === 'confirmChange')
          view = {
            configured: true,
            status: 'connected',
            message: 'Change confirmed by SDP.',
            changeResult: { id: '999', number: '999', kind: 'create' },
          };
        if (command.action === 'cancelChange') delete view.review;
        if (command.action === 'clearCopies') view = { configured: true, status: 'connected' };
        if (command.action === 'readQueue')
          view = {
            configured: true,
            status: 'connected',
            queuePage: {
              queue: command.queue,
              page: command.page,
              hasMore: true,
              tickets: [
                {
                  id: '123',
                  number: '810129',
                  subject: 'Synthetic live queue ticket with a readable subject',
                  status: 'Open',
                  priority: 'Low',
                  group: command.queue,
                  technician: 'Example operator',
                  createdAt: 1000,
                  dueAt: null,
                },
              ],
            },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          };
        if (command.action === 'readForm')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              form: {
                id: '123',
                template: { id: '7', name: 'Example incident template' },
                canEdit: true,
                fields: [
                  {
                    key: 'subject',
                    label: 'Subject',
                    kind: 'text',
                    value: 'Synthetic live queue ticket with a readable subject',
                    required: true,
                    choices: [],
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    kind: 'lookup',
                    value: { id: '1', name: 'Open' },
                    required: true,
                    choices: [
                      { label: 'Open', value: { id: '1', name: 'Open' } },
                      { label: 'Closed', value: { id: '2', name: 'Closed' } },
                    ],
                  },
                  {
                    key: 'priority',
                    label: 'Priority',
                    kind: 'lookup',
                    value: { id: '3', name: 'Low' },
                    required: false,
                    choices: [
                      { label: 'Low', value: { id: '3', name: 'Low' } },
                      { label: 'High', value: { id: '4', name: 'High' } },
                    ],
                  },
                  {
                    key: 'description',
                    label: 'Description',
                    kind: 'multiline',
                    value: '<p>Synthetic ticket description</p>',
                    required: false,
                    choices: [],
                  },
                ].map((f) => ({
                  ...f,
                  section: 'Request details',
                  readOnly: false,
                  multiple: false,
                  maxLength: 12000,
                  dependencies: [],
                })),
              },
            },
          };
        if (command.action === 'readReplyContext')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              replyContext: {
                id: '123',
                to: ['requester@example.test'],
                cc: [],
                subject: 'Re: Synthetic ticket',
                canReply: true,
              },
            },
          };
        if (command.action === 'readResources')
          view = {
            ...view,
            resources: {
              id: command.id,
              resource: command.resource,
              page: 0,
              hasMore: false,
              rows: [
                {
                  id: '77',
                  title: 'Investigate example issue',
                  status: 'Open',
                  fields: { title: 'Investigate example issue', status: 'Open' },
                },
              ],
            },
          };
        if (command.action === 'readDetail')
          view = {
            ...view,
            ...notificationSummary(command.id),
            detail: {
              id: command.id,
              description: '<p>Synthetic ticket description</p>',
              includeAutoNotifications: command.includeAutoNotifications === true,
              attachments: [{ id: '44', name: 'example.txt', size: 20, contentType: 'text/plain' }],
              page: 0,
              hasMore: false,
              conversations: [
                {
                  id: '456',
                  author: 'Example operator',
                  subject: 'Synthetic reply',
                  body: '<p>Conversation body for testing</p>',
                  createdAt: 1000,
                },
                ...(command.includeAutoNotifications
                  ? [
                      {
                        id: '457',
                        author: 'System',
                        subject: 'Automatic assignment notice',
                        body: '<p>Synthetic automatic notification</p>',
                        createdAt: 900,
                      },
                    ]
                  : []),
              ],
            },
            detailSnapshot: {
              source: 'live',
              fetchedAt: Date.now(),
              expiresAt: Date.now() + 60000,
            },
          };
        return { success: true, data: { ...view, testControls: true } };
      });
    });
    await page.getByRole('button', { name: 'NOC', exact: true }).click();
    const liveRow = page.getByRole('button', { name: /Open ticket 810129/ });
    await expect(liveRow).toBeVisible();
    const geometry = await liveRow.boundingBox();
    expect(geometry!.width).toBeGreaterThan(300);
    expect(geometry!.height).toBeLessThan(140);
    const dueFilter = page.locator('.sdp-queue-filters').getByLabel('Due', { exact: true });
    await dueFilter.focus();
    await dueFilter.press('Space');
    await expect(dueFilter).toHaveJSProperty('value', '');
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-filter-dropdown.png'),
    });
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(dueFilter).toHaveValue('today');
    await dueFilter.selectOption('');
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-queue-workspace.png'),
    });
    await liveRow.click();
    const liveDialog = page.getByRole('complementary', { name: 'Ticket 810129', exact: true });
    await expect(liveDialog.getByText('Synthetic ticket description')).toBeHidden();
    await expect(liveDialog.getByRole('button', { name: 'Previous activity' })).toHaveCount(0);
    const automaticNotifications = liveDialog.getByRole('checkbox', {
      name: 'Show automatic notifications',
    });
    await expect(automaticNotifications).not.toBeChecked();
    await expect(liveDialog.getByText('Synthetic automatic notification')).toHaveCount(0);
    await automaticNotifications.check();
    await expect(liveDialog.getByText('Synthetic automatic notification')).toBeVisible();
    await automaticNotifications.uncheck();
    await expect(liveDialog.getByText('Synthetic automatic notification')).toHaveCount(0);

    await liveDialog.locator('summary').filter({ hasText: 'Original request' }).click();
    await expect(liveDialog.getByText('Synthetic ticket description')).toBeVisible();
    const queueBounds = await page
      .getByRole('region', { name: 'Live tickets in queue' })
      .boundingBox();
    const panelBounds = await liveDialog.boundingBox();
    expect(panelBounds!.x).toBeGreaterThan(queueBounds!.x);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-conversation-workspace.png'),
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 1000));
    await expect(page.getByRole('region', { name: 'Live tickets in queue' })).toBeHidden();
    await expect(page.locator('.sdp-queue-filters')).toBeHidden();
    await expect(liveDialog.getByText('Synthetic ticket description')).toBeVisible();
    const narrowBounds = await liveDialog.boundingBox();
    expect(narrowBounds!.width).toBeLessThan(900);
    expect(narrowBounds!.x).toBeGreaterThanOrEqual(64);
    expect(narrowBounds!.x + narrowBounds!.width).toBeLessThanOrEqual(900);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-narrow-workspace.png'),
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 1000));
    await expect(liveDialog.getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
    const overviewBounds = await liveDialog
      .getByRole('region', { name: 'Ticket overview' })
      .boundingBox();
    const threadBounds = await liveDialog
      .getByRole('navigation', { name: 'Ticket sections' })
      .boundingBox();
    expect(overviewBounds!.y).toBeLessThan(threadBounds!.y);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-compact-workspace.png'),
    });
    await liveDialog.getByRole('button', { name: 'Back to queue', exact: true }).click();
    await expect(liveRow).toBeFocused();
    await expect(page.locator('.sdp-queue-filters')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
    await liveRow.click();
    await liveDialog.getByRole('button', { name: 'Edit ticket', exact: true }).click();
    const statusField = liveDialog.getByLabel('Status', { exact: true });
    await statusField.click();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-editor-dropdown.png'),
    });
    await statusField.press('Escape');
    await statusField.selectOption('2');
    await liveDialog
      .getByLabel('Description', { exact: true })
      .fill('Draft preserved < while editing');
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-side-panel-editor.png'),
    });
    await liveDialog.getByRole('button', { name: 'Review changes', exact: true }).click();
    await expect(liveDialog.getByRole('region', { name: 'Review SDP change' })).toContainText(
      'Closed',
    );
    await liveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await liveDialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
    const moreActions = liveDialog.getByRole('button', { name: 'More actions' });
    await moreActions.click();
    await expect(page.getByRole('menuitem', { name: 'Resolve ticket' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(moreActions).toBeFocused();
    await liveDialog.getByRole('button', { name: 'Reply', exact: true }).click();
    await liveDialog
      .getByLabel('Message', { exact: true })
      .fill('Synthetic email for review only.');
    await expect(liveDialog.getByText('Conversation body for testing')).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-inline-reply.png'),
    });
    await app.evaluate(() => (globalThis as { replySdpForTest?: () => void }).replySdpForTest?.());
    await expect(liveDialog.getByText('Unread reply', { exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(liveDialog.getByText(/Last message: Example requester/)).toBeVisible();
    await expect(liveDialog.getByRole('button', { name: 'Load latest reply' })).toBeDisabled();
    await expect(liveDialog.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
      'Synthetic email for review only.',
    );
    await liveDialog.getByRole('button', { name: 'Review email', exact: true }).click();
    await expect(liveDialog.getByRole('region', { name: 'Review SDP change' })).toContainText(
      'requester@example.test',
    );
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-reply-review.png'),
    });
    await liveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await liveDialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await liveDialog.getByRole('button', { name: 'Conversation', exact: true }).click();
    await expect(liveDialog.getByText('Conversation body for testing')).toBeVisible();
    await liveDialog.getByRole('button', { name: 'Attachments', exact: true }).click();
    await expect(liveDialog.getByRole('button', { name: 'Save example.txt' })).toBeEnabled();
    await liveDialog.getByRole('button', { name: 'Work', exact: true }).click();
    await liveDialog.getByRole('button', { name: 'Tasks', exact: true }).click();
    await expect(
      liveDialog.getByRole('heading', { name: 'Investigate example issue' }),
    ).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-native-ticket-work.png'),
    });
    await liveDialog.getByRole('button', { name: 'Edit', exact: true }).click();
    const taskEditor = page.getByRole('dialog', { name: 'update · Tasks', exact: true });
    await taskEditor.getByLabel('Title', { exact: true }).fill('Review example issue');
    await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveCount(1);
    await app.evaluate(() =>
      (globalThis as { refreshSdpQueueForTest?: () => void }).refreshSdpQueueForTest?.(),
    );
    await expect(page.getByRole('button', { name: /Open ticket 810130/ })).toHaveCount(1, {
      timeout: 10000,
    });
    await expect(taskEditor.getByLabel('Title', { exact: true })).toHaveValue(
      'Review example issue',
    );
    await expect(liveDialog).toBeVisible();
    await taskEditor.getByRole('button', { name: 'Review change', exact: true }).click();
    await expect(taskEditor.getByRole('button', { name: 'Confirm live change' })).toBeVisible();
    await expect(taskEditor.getByRole('region', { name: 'Review live change' })).toContainText(
      'Review example issue',
    );
    await taskEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await liveDialog.getByRole('button', { name: 'Back to queue', exact: true }).click();
    await page.getByRole('button', { name: 'Clear my saved SDP data', exact: true }).click();
    await expect(liveRow).toHaveCount(0);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const notifications = page.getByRole('dialog', { name: 'Notifications', exact: true });
    await notifications.getByRole('button', { name: 'Preferences', exact: true }).click();
    await notifications.locator('summary').filter({ hasText: 'Tickets' }).click();
    await expect(
      notifications.getByRole('button', { name: 'Monitor queues', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-notifications.png'),
    });
    await notifications.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Notifications/ })).toBeFocused();
    await page.getByRole('button', { name: 'Major incident', exact: true }).click();
    const liveCreate = page.getByRole('dialog', { name: 'Create major incident', exact: true });
    await liveCreate
      .getByLabel('Subject', { exact: true })
      .fill('Synthetic confirmation smoke test');
    await liveCreate.getByLabel('Requester email', { exact: true }).fill('test@example.test');
    await expect(
      liveCreate.getByRole('checkbox', { name: 'Major Incident', exact: true }),
    ).toBeChecked();
    await liveCreate.getByRole('button', { name: 'Review change', exact: true }).click();
    await expect(liveCreate).toContainText('Major Incident: Yes (checked in SDP)');
    await expect(liveCreate.getByRole('region', { name: 'Review live change' })).toContainText(
      'Synthetic confirmation smoke test',
    );
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('sdp-confirmation.png'),
    });
    await liveCreate.getByRole('button', { name: 'Confirm live change', exact: true }).click();
    await expect(liveCreate.getByRole('status')).toContainText('Change confirmed by SDP.');
    await expect(
      liveCreate.getByRole('button', { name: 'Confirm live change', exact: true }),
    ).toHaveCount(0);
    await liveCreate.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Synthetic workspace' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Load sample tickets' })).toHaveCount(0);
    // Global ticket monitoring stays alive after leaving Tickets, and the alert opens its ticket.
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await notifications.getByRole('button', { name: 'Preferences', exact: true }).click();
    await notifications.locator('summary').filter({ hasText: 'Tickets' }).click();
    await notifications.getByRole('button', { name: 'Ticket rules', exact: true }).click();
    const rules = page.getByRole('dialog', { name: 'Ticket notification rules' });
    await rules.getByRole('button', { name: 'Add rule', exact: true }).click();
    await rules.getByLabel('Rule name', { exact: true }).last().fill('Background arrivals');
    await rules.getByRole('button', { name: 'Save rules', exact: true }).click();
    await notifications.locator('summary').filter({ hasText: 'Tickets' }).click();
    await notifications.getByRole('button', { name: 'Monitor queues', exact: true }).click();
    await expect(notifications.getByRole('status')).toContainText('0 tickets checked');
    await notifications.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByTestId('sidebar-compose').click();
    await app.evaluate(() =>
      (globalThis as { addSdpNotificationForTest?: () => void }).addSdpNotificationForTest?.(),
    );
    await expect(
      page.locator('.toast-container').getByText('Ticket #810131', { exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await page
      .locator('.toast-container')
      .getByRole('button', { name: 'Open Tickets', exact: true })
      .click();
    const notifiedTicket = page.getByRole('complementary', { name: 'Ticket 810131', exact: true });
    await expect(
      notifiedTicket.getByRole('heading', { name: 'Background ticket alert' }),
    ).toBeVisible();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await notifications.getByRole('button', { name: 'Inbox', exact: true }).click();
    await notifications.getByRole('button', { name: 'Tickets', exact: true }).click();
    await expect(notifications.getByRole('button', { name: /Ticket #810131/ })).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('global-notification-inbox.png'),
    });
    await notifications.getByRole('button', { name: /Ticket #810131/ }).click();
    await expect(notifiedTicket).toBeVisible();
    await page.getByTestId('sidebar-problems').click();
    await page.getByRole('button', { name: /Synthetic checkout outage/ }).click();
    await expect(page.getByRole('region', { name: 'Linked SDP tickets' })).toBeVisible();
    await expect(page.getByText('Linked synthetic tickets')).toHaveCount(0);
  } catch (error) {
    const page = await app.firstWindow();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('ticket-failure.png'),
    });
    console.error((await page.locator('body').innerText()).slice(-7000));
    throw error;
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('request history, forwarding, checklists, reminders and bulk reviews work with isolated fixtures', async ({
  playwright,
}, testInfo) => {
  test.setTimeout(150000);
  const root = mkdtempSync(join(tmpdir(), 'relay-ticket-parity-e2e-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(
    join(root, 'data/config.json'),
    JSON.stringify({ mode: 'server', port: 20000 + randomInt(20000), secret: randomUUID() }),
  );
  const env = { ...process.env, NODE_ENV: 'test' };
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  const app = await playwright._electron.launch({
    args: [`--user-data-dir=${root}`, join(process.cwd(), 'dist/main/index.js')],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('sidebar-compose')).toBeVisible({ timeout: 30000 });
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1500, 1000);
      const ticket = {
        id: '123',
        number: '900123',
        subject: 'Synthetic parity fixture',
        status: 'Open',
        priority: 'Low',
        group: 'NOC',
        technician: 'Example',
        createdAt: Date.now(),
        dueAt: null,
      };
      const snapshot = { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 3600000 };
      let view: Record<string, unknown> = {
        configured: true,
        status: 'connected',
        queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket] },
        snapshot,
      };
      const catalog: Record<string, { id: string; name: string }[]> = {
        group: [
          { id: '10', name: 'NOC' },
          { id: '11', name: 'SOX' },
        ],
        technician: [{ id: '20', name: 'Ryan' }],
        status: [{ id: '2', name: 'Closed' }],
      };
      ipcMain.removeHandler('sdp:account');
      ipcMain.handle('sdp:account', (_event, c) => {
        if (c.action === 'readDetail')
          view = {
            ...view,
            detail: {
              id: c.id,
              page: 0,
              hasMore: false,
              description: '<p>Original request</p>',
              attachments: [
                { id: '44', name: 'example.txt', size: 20, contentType: 'text/plain' },
                {
                  id: '45',
                  name: 'Database-diagnostics-for-primary-cluster-after-scheduled-maintenance-2026-09-20.log',
                  size: 1536,
                  contentType: 'text/plain',
                },
                {
                  id: '46',
                  name: 'full-diagnostics.zip',
                  size: 11 * 1024 * 1024,
                  contentType: 'application/zip',
                },
              ],
              conversations: [
                {
                  id: '77',
                  author: 'Requester',
                  createdAt: Date.now(),
                  subject: 'Follow up',
                  body: '<p>Sample message</p>',
                },
              ],
            },
            detailSnapshot: snapshot,
          };
        if (c.action === 'readTicketRelations')
          return {
            success: true,
            data: {
              ...view,
              ticketRelations: {
                id: c.id,
                linked: [{ id: '456', number: '900456', subject: 'Related network investigation' }],
                candidate: c.number
                  ? { id: '789', number: '900789', subject: 'Duplicate report' }
                  : null,
                canLink: true,
                canUnlink: true,
                canMerge: true,
                hasMore: false,
              },
            },
          };
        if (c.action === 'readHistory')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              history: {
                id: c.id,
                page: c.page,
                hasMore: false,
                entries: [
                  {
                    id: '1',
                    at: Date.now(),
                    author: 'Example',
                    operation: 'edit',
                    description: 'Changed priority',
                    changes: [{ field: 'Priority', before: 'Low', after: 'High' }],
                  },
                ],
              },
            },
          };
        if (c.action === 'readStandardOptions')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              options: {
                field: c.field,
                hasMore: false,
                choices: (catalog[c.field] ?? []).map((value) => ({ label: value.name, value })),
              },
            },
          };
        if (c.action === 'readForwardContext')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              replyContext: {
                id: c.id,
                to: [],
                cc: [],
                subject: 'Fwd: Follow up',
                body: '<p>Sample message</p>',
                canReply: true,
              },
            },
          };
        const resourceRows: Record<string, unknown[]> = {
          checklists: [
            {
              id: '8',
              title: 'Recovery checklist',
              status: '',
              fields: { name: 'Recovery checklist' },
            },
          ],
          checklistitems: [
            {
              id: '9',
              title: 'Verify service',
              status: '',
              fields: { itemId: '10', completed: 'false', value: 'Pending' },
            },
          ],
        };
        if (c.action === 'readResources')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              resources: {
                id: c.id,
                resource: c.resource,
                page: 0,
                hasMore: false,
                checklistId: c.checklistId,
                rows: resourceRows[c.resource] ?? [],
              },
            },
          };
        if (c.action === 'readResourceChoices')
          return {
            success: true,
            data: {
              configured: true,
              status: 'connected',
              resourceChoices: {
                catalog: c.catalog,
                page: 0,
                hasMore: false,
                choices: [{ id: '10', name: 'Verify service' }],
              },
            },
          };
        if (c.action === 'prepareChange')
          view = {
            ...view,
            review: {
              confirmationId: '00000000-0000-4000-8000-000000000001',
              expiresAt: Date.now() + 60000,
              mutation: c.mutation,
            },
          };
        if (c.action === 'confirmChange')
          view = {
            ...view,
            review: undefined,
            bulkResult: [{ id: '123', status: 'confirmed' }],
            message: 'Fixture changes confirmed',
          };
        if (c.action === 'cancelChange') view = { ...view, review: undefined };
        return { success: true, data: view };
      });
    });
    await page.getByTestId('sidebar-tickets').click();
    await page.getByRole('button', { name: /Open ticket 900123/ }).click();
    const workspace = page.getByRole('complementary', { name: 'Ticket 900123' });
    await expect(
      workspace.getByRole('navigation', { name: 'Ticket sections' }).getByRole('button'),
    ).toHaveCount(6);
    await expect(workspace.getByRole('button', { name: 'Forward', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('tickets-simplified.png') });
    await workspace.getByRole('button', { name: 'Attachments', exact: true }).click();
    const attachmentPanel = workspace.getByRole('region', { name: 'Ticket attachments' });
    await expect(
      attachmentPanel.getByRole('button', { name: 'Save full-diagnostics.zip' }),
    ).toBeDisabled();
    for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all())
      await dismiss.click();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('ticket-attachments.png'),
    });
    const addAttachment = attachmentPanel.getByRole('button', {
      name: 'Add attachment',
      exact: true,
    });
    const chooserReady = page.waitForEvent('filechooser');
    await addAttachment.focus();
    await page.keyboard.press('Enter');
    const chooser = await chooserReady;
    await chooser.setFiles({
      name: 'evidence.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('synthetic evidence'),
    });
    const uploadReview = page.getByRole('dialog', { name: 'Review attachment upload' });
    await expect(uploadReview.getByText('evidence.txt')).toBeVisible();
    await expect(uploadReview.getByText('18 B · Ticket 900123')).toBeVisible();
    await expect(uploadReview.getByRole('button', { name: 'Upload attachment' })).toBeEnabled();
    await expect(uploadReview).toHaveAttribute('data-state', 'open');
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('ticket-attachment-review.png'),
    });
    await uploadReview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(addAttachment).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(800, 900));
    await page.mouse.move(750, 450);
    await expect
      .poll(() =>
        page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeLessThan(100);
    await expect(
      attachmentPanel.getByText(
        'Database-diagnostics-for-primary-cluster-after-scheduled-maintenance-2026-09-20.log',
      ),
    ).toBeVisible();
    await expect
      .poll(() => attachmentPanel.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('ticket-attachments-narrow.png'),
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1500, 1000),
    );

    await workspace.getByRole('button', { name: 'Related', exact: true }).click();
    await expect(workspace.getByRole('heading', { name: 'Dynatrace problems' })).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'SDP tickets' })).toBeVisible();
    await expect(workspace.getByLabel('Ticket number', { exact: true })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('tickets-related.png') });
    await workspace.getByText('Link or merge a ticket', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await workspace.getByLabel('Ticket number', { exact: true }).fill('900789');
    await workspace.getByRole('button', { name: 'Find ticket', exact: true }).click();
    await workspace
      .getByRole('button', { name: 'Merge duplicate into 900123', exact: true })
      .click();
    await expect(
      workspace.getByRole('region', { name: 'Review ticket relationship' }),
    ).toContainText('900789');
    await workspace.getByRole('button', { name: 'Cancel', exact: true }).click();
    await workspace.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Prepare incident bridge' }).click();
    await expect(page.getByRole('dialog', { name: 'Prepare incident bridge' })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Prepare incident bridge' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(
      workspace.getByRole('button', { name: 'More actions', exact: true }),
    ).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 900));
    await page.mouse.move(750, 120);
    await expect
      .poll(async () =>
        page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeLessThan(100);
    await expect(workspace.getByRole('button', { name: 'Related', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('tickets-related-narrow.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 1000));
    await workspace.getByRole('button', { name: 'Details', exact: true }).click();
    await workspace.getByRole('button', { name: 'History', exact: true }).click();
    await expect(workspace.getByText('Low → High')).toBeVisible();
    await workspace.getByRole('button', { name: 'Conversation', exact: true }).click();
    await workspace.getByRole('button', { name: 'Forward message', exact: true }).click();
    const forward = workspace.getByRole('region', { name: 'Forward ticket', exact: true });
    await expect(forward.getByLabel('Message')).toHaveValue('Sample message');
    await expect(forward.getByLabel('To', { exact: true })).toHaveValue('');
    await forward.getByLabel('To', { exact: true }).fill('recipient@example.test');
    await forward.getByRole('button', { name: 'Review email', exact: true }).click();
    await expect(forward.getByRole('button', { name: 'Confirm and send' })).toBeVisible();
    await forward.getByRole('button', { name: 'Cancel', exact: true }).click();
    await forward.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await workspace.getByRole('button', { name: 'Work', exact: true }).click();
    await workspace.getByRole('button', { name: 'Checklists', exact: true }).click();
    await workspace.getByRole('button', { name: 'View items', exact: true }).click();
    await workspace.getByRole('button', { name: 'Edit', exact: true }).click();
    const item = page.getByRole('dialog', { name: 'update · Checklist items' });
    await item.getByLabel('Completed', { exact: true }).selectOption('true');
    await item.getByLabel('Answer', { exact: true }).fill('Verified locally');
    await item.getByRole('button', { name: 'Review change', exact: true }).click();
    await expect(item.getByRole('button', { name: 'Confirm live change' })).toBeVisible();
    await item.getByRole('button', { name: 'Cancel', exact: true }).click();
    await workspace.getByRole('button', { name: 'Reminders', exact: true }).click();
    await workspace.getByRole('button', { name: 'Add reminders', exact: true }).click();
    const reminder = page.getByRole('dialog', { name: 'create · Reminders' });
    await reminder.getByLabel('Summary', { exact: true }).fill('Follow up tomorrow');
    await reminder.getByLabel('Date and time', { exact: true }).fill('2026-10-01T10:30');
    await reminder.getByLabel('Email me before', { exact: true }).selectOption('30');
    await reminder.getByRole('button', { name: 'Review change', exact: true }).click();
    await expect(reminder.getByRole('button', { name: 'Confirm live change' })).toBeVisible();
    await reminder.getByRole('button', { name: 'Cancel', exact: true }).click();
    await workspace.getByRole('button', { name: 'Back to queue' }).click();
    await page.getByRole('checkbox', { name: 'Select ticket 900123' }).check();
    await page.getByRole('button', { name: 'Update selected (1)' }).click();
    const bulk = page.getByRole('dialog', { name: 'Update selected tickets' });
    await bulk.getByLabel('Status', { exact: true }).focus();
    await expect(bulk.getByRole('option', { name: 'Closed' })).toBeAttached();
    await bulk.getByLabel('Status', { exact: true }).selectOption('Closed');
    await bulk.getByRole('button', { name: 'Review bulk changes' }).click();
    await bulk.getByRole('button', { name: 'Confirm 1 live changes' }).click();
    await expect(bulk.getByText(/Confirmed by SDP/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('ticket-bulk-results.png'),
      animations: 'disabled',
    });
    await bulk.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'New ticket', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'New SDP ticket' });
    await create.getByLabel('Subject', { exact: true }).fill('Synthetic dropdown test');
    await create.getByLabel('Support group', { exact: true }).focus();
    await expect(create.getByRole('option', { name: 'NOC', exact: true })).toBeAttached();
    await create.getByLabel('Support group', { exact: true }).selectOption('NOC');
    await create.getByLabel('Technician', { exact: true }).focus();
    await expect(create.getByRole('option', { name: 'Ryan', exact: true })).toBeAttached();
    await create.getByLabel('Technician', { exact: true }).selectOption('Ryan');
    await create.getByLabel('Support group', { exact: true }).selectOption('SOX');
    await expect(create.getByLabel('Technician', { exact: true })).toHaveValue('');
    await create.getByRole('button', { name: 'Review change', exact: true }).click();
    await expect(create.getByRole('region', { name: 'Review live change' })).toContainText('SOX');
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
