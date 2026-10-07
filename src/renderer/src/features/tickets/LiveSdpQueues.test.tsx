import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { SdpBody } from './SdpBody';
import { SdpTicketContent } from './SdpTicketContent';
import { LiveSdpQueues } from './LiveSdpQueues';
import type { ReactNode } from 'react';

/** The freshness readout by its whole text; its caption, time and note are separate spans. */
const readout = (text: string | RegExp) => (_content: string, element: Element | null) =>
  !!element?.classList.contains('tab-freshness') &&
  (typeof text === 'string' ? element.textContent === text : text.test(element.textContent ?? ''));
vi.mock('../../services/pocketbase', () => ({ getPb: () => ({ baseURL: 'http://relay.test' }) }));
vi.mock('../../components/StatusBar', () => ({
  StatusBar: ({ right }: { right: ReactNode }) => <div data-testid="status-bar">{right}</div>,
  StatusBarLive: () => null,
}));
vi.mock('../../hooks/useCollection', () => ({
  useCollection: () => ({ data: [], error: null, refetch: vi.fn() }),
}));
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
  vi.useRealTimers();
});
const ticket = {
  id: '123',
  number: '810129',
  subject: 'Synthetic live subject',
  status: 'Open',
  priority: 'Low',
  group: 'NOC',
  technician: 'Example technician',
  createdAt: 1000,
  dueAt: null,
};
it('keeps queue controls separate and clears ticket details after deleting saved data', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      testControls: true,
      status: 'connected',
      ...(['readQueue', 'readDetail'].includes(command.action)
        ? {
            queuePage: {
              queue: command.queue ?? 'NOC',
              page: command.page,
              hasMore: true,
              tickets: [{ ...ticket, group: command.queue ?? 'NOC' }],
            },
            ...(command.action === 'readDetail'
              ? {
                  detail: {
                    id: command.id,
                    includeAutoNotifications: command.includeAutoNotifications ?? false,
                    properties: [{ label: 'Impact', value: 'Single user' }],
                    notes: [
                      {
                        id: '7',
                        body: '<p>Example internal note</p>',
                        author: 'Example technician',
                        createdAt: 1000,
                      },
                    ],
                    description: '<p>Example description</p>',
                    page: 0,
                    hasMore: false,
                    conversations: [
                      {
                        id: '5',
                        author: 'Example author',
                        subject: 'Reply',
                        body: '<p>Example reply</p>',
                        createdAt: 1000,
                      },
                    ],
                  },
                }
              : {}),
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic live subject/ }));
  expect(screen.getByRole('complementary', { name: 'Ticket 810129' })).toHaveTextContent(
    'Example technician',
  );
  await screen.findByText('Example description');
  expect(screen.getByText('Example description')).not.toBeVisible();
  fireEvent.click(screen.getByText('Description', { selector: 'summary' }));
  expect(screen.getByText('Example description')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Automatic notifications' }));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Automatic notifications' })).toBeChecked(),
  );
  expect(invoke).toHaveBeenCalledWith({
    action: 'readDetail',
    id: '123',
    page: 0,
    includeAutoNotifications: true,
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Automatic notifications' }));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Automatic notifications' })).not.toBeChecked(),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
  expect(screen.getByText('Single user')).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Notes' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
  expect(screen.getByText('Example internal note')).toBeVisible();
  expect(screen.getByText('Example reply')).toBeVisible();
  expect(invoke).toHaveBeenCalledWith({ action: 'readDetail', id: '123', page: 0 });
  const more = screen.getByRole('button', { name: 'More Actions' });
  more.focus();
  fireEvent.click(more);
  expect(screen.getByRole('menuitem', { name: 'Refresh Ticket' })).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(more).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Queue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({ action: 'readQueue', queue: 'NOC', page: 1 }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clear My Saved SDP Data' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear My Saved SDP Data' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /Synthetic live subject/ }),
    ).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith({ action: 'clearCopies' });
  expect(screen.getByRole('button', { name: 'New Ticket' })).toBeEnabled();
});
it('replaces unusable queues with an account connection action when signed out', async () => {
  globalThis.api = {
    ...original,
    runtime: ELECTRON_RUNTIME,
    sdpAccount: vi
      .fn()
      .mockResolvedValue({ success: true, data: { configured: true, status: 'disconnected' } }),
  } as BridgeAPI;
  render(<LiveSdpQueues />);
  const connect = await screen.findByRole('button', { name: 'Connect Work Account' });
  await waitFor(() => expect(connect).toBeEnabled());
  expect(screen.queryByLabelText('Search queue')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'New Ticket' })).not.toBeInTheDocument();
  fireEvent.click(connect);
  expect(await screen.findByRole('dialog', { name: 'Your SDP connection' })).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Sign In with Work Account' })).toBeEnabled();
});

it('keeps the last loaded rows and says so when a refresh cannot reach Relay', async () => {
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket] },
      snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
    },
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await screen.findByRole('button', { name: /Synthetic live subject/ });
  invoke.mockResolvedValue({ success: false, error: 'offline' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Queue' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: /Synthetic live subject/ })).toBeVisible();
  expect(screen.getByText(readout(/^Updated .* · may be stale$/))).toBeVisible();
  expect(screen.getByText(/^Not updated since .* · Retrying$/)).toHaveClass('sr-only');
});

it('keeps the queue on screen when a background status check fails', async () => {
  vi.useFakeTimers();
  const loaded = {
    success: true as const,
    data: {
      configured: true,
      status: 'connected' as const,
      queuePage: { queue: 'NOC' as const, page: 0, hasMore: false, tickets: [ticket] },
      snapshot: { source: 'live' as const, fetchedAt: Date.now(), expiresAt: Date.now() + 600000 },
    },
  };
  const invoke = vi.fn().mockResolvedValue(loaded);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByRole('button', { name: /Synthetic live subject/ })).toBeVisible();
  invoke.mockRejectedValue(new Error('Relay unreachable'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.getByRole('button', { name: /Synthetic live subject/ })).toBeVisible();
  expect(
    screen.getByText(
      'Relay is not responding. Showing the last loaded tickets until the saved copy expires.',
    ),
  ).toBeVisible();
  invoke.mockResolvedValue(loaded);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.queryByText(/Relay is not responding/)).not.toBeInTheDocument();
  expect(screen.getByText(readout(/^Updated \d{1,2}:\d{2}/))).not.toHaveClass(
    'tab-freshness--stale',
  );
  expect(screen.getByText('Live from SDP')).toHaveClass('sr-only');
});

it('moves between tickets with J and K and returns to the queue with Escape', async () => {
  const second = { ...ticket, id: '124', number: '810130', subject: 'Second live subject' };
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket, second] },
      snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
      ...(command.action === 'readDetail'
        ? {
            detail: { id: command.id, description: '', page: 0, hasMore: false, conversations: [] },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  const first = await screen.findByRole('button', { name: /Synthetic live subject/ });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.keyDown(document.body, { key: 'j' });
  expect(first).toHaveFocus();
  // A row's checkbox keeps the shortcuts and moves from its own row.
  const check = screen.getByRole('checkbox', { name: 'Select ticket 810129' });
  check.focus();
  fireEvent.keyDown(check, { key: 'j' });
  expect(screen.getByRole('button', { name: /Second live subject/ })).toHaveFocus();
  fireEvent.click(first);
  await screen.findByRole('complementary', { name: 'Ticket 810129' });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.keyDown(document.body, { key: 'j' });
  await screen.findByRole('complementary', { name: 'Ticket 810130' });
  // Queue notes and other background reads may land after the detail read.
  const details = invoke.mock.calls.filter(([command]) => command.action === 'readDetail');
  expect(details.at(-1)).toEqual([{ action: 'readDetail', id: '124', page: 0 }]);
  const opener = screen.getByRole('button', { name: /Second live subject/ });
  await waitFor(() => expect(opener).toBeEnabled());
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  await waitFor(() => expect(opener).toHaveFocus());
});

it('renders provider HTML as inert text without scripts, remote media or clickable URLs', () => {
  const { container } = render(
    <SdpBody
      html={
        '<p>Hello &amp; welcome</p><script>bad()</script><img src="https://tracking.test/pixel"><a href="javascript:bad()">Reply</a>'
      }
    />,
  );
  expect(container).toHaveTextContent('Hello & welcome');
  expect(container).toHaveTextContent('Reply');
  expect(container.querySelector('script,img,a,iframe')).toBeNull();
  expect(container.querySelector('p')).not.toBeNull();
  expect(container).not.toHaveTextContent('bad()');
});

it('preserves complete form tables while discarding source styles and event handlers', () => {
  const { container } = render(
    <SdpBody
      html={
        '<table style="height:9000px" onclick="bad()"><tr><td>Responsibilities</td><td>Example access</td></tr><tr><td>Approval limit</td><td>1500</td></tr></table>'
      }
    />,
  );
  expect(container.querySelectorAll('tr')).toHaveLength(2);
  expect(container).toHaveTextContent('Approval limit');
  expect(container).toHaveTextContent('1500');
  expect(container.querySelector('[style],[onclick]')).toBeNull();
});

it('never shows demo controls and hides cache clearing without local test capability', async () => {
  globalThis.api = {
    ...original,
    runtime: ELECTRON_RUNTIME,
    sdpAccount: vi.fn().mockResolvedValue({
      success: true,
      data: { configured: true, status: 'connected', testControls: false },
    }),
  } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'New Ticket' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Synthetic workspace' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Clear My Saved SDP Data' })).not.toBeInTheDocument();
});

it('only offers activity paging when the active feed has another page or a previous page', () => {
  const onPage = vi.fn();
  const detail = {
    id: '123',
    description: '',
    conversations: [],
    notes: [],
    page: 0,
    hasMore: false,
    notesHasMore: true,
  };
  const props = { detail, busy: false, onPage, setSection: vi.fn() };
  const view = render(<SdpTicketContent {...props} section="Conversations" />);
  expect(screen.queryByRole('button', { name: 'Older Activity' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show Newer Messages' })).not.toBeInTheDocument();
  // Older notes are part of the thread while notes are shown.
  fireEvent.click(screen.getByRole('button', { name: 'Show Earlier Messages' }));
  expect(onPage).toHaveBeenLastCalledWith(1);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Notes' }));
  expect(screen.queryByRole('button', { name: 'Show Earlier Messages' })).not.toBeInTheDocument();
  view.rerender(
    <SdpTicketContent {...props} section="Conversations" detail={{ ...detail, page: 1 }} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show Newer Messages' }));
  expect(onPage).toHaveBeenLastCalledWith(0);
});

it('opens a notified ticket outside the current queue from the authorized detail summary', async () => {
  const notified = {
    ...ticket,
    id: '999',
    number: '99',
    subject: 'Notified SOX ticket',
    group: 'SOX',
  };
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [] },
      snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
      ...(command.action === 'readDetail'
        ? {
            replyActivity: notified,
            detail: {
              id: '999',
              description: '<p>Notified conversation</p>',
              page: 0,
              hasMore: false,
              conversations: [],
            },
            detailSnapshot: {
              source: 'live',
              fetchedAt: Date.now(),
              expiresAt: Date.now() + 60000,
            },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(
    <LiveSdpQueues
      request={{ destination: 'ticket', source: 'sdp', ticketId: '999', sequence: 1 }}
    />,
  );
  await screen.findByRole('complementary', { name: 'Ticket 99' });
  expect(invoke).toHaveBeenCalledWith({ action: 'readDetail', id: '999', page: 0 });
  expect(screen.getByRole('heading', { name: 'Notified SOX ticket' })).toBeVisible();
});

it('groups ticket navigation into five sections without losing detail views', () => {
  const detail = {
    id: '123',
    description: 'Original request',
    conversations: [],
    page: 0,
    hasMore: false,
  };
  const setSection = vi.fn();
  const props = { detail, busy: false, onPage: vi.fn(), setSection };
  const view = render(<SdpTicketContent {...props} section="Conversations" />);
  const navigation = screen.getByRole('tablist', { name: 'Ticket sections' });
  expect(within(navigation).getAllByRole('tab')).toHaveLength(5);
  expect(within(navigation).queryByRole('tab', { name: 'Messages' })).toBeNull();
  expect(within(navigation).queryByRole('tab', { name: 'Notes' })).toBeNull();
  fireEvent.click(within(navigation).getByRole('tab', { name: 'Related' }));
  expect(setSection).toHaveBeenLastCalledWith('Links & bridge');
  view.rerender(<SdpTicketContent {...props} section="History" />);
  expect(within(navigation).getByRole('tab', { name: 'Details' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  fireEvent.keyDown(within(navigation).getByRole('tab', { name: 'Details' }), {
    key: 'ArrowRight',
  });
  expect(setSection).toHaveBeenLastCalledWith('Conversations');
  expect(within(navigation).getByRole('tab', { name: 'Conversation' })).toHaveFocus();
  const details = screen.getByRole('tablist', { name: 'Ticket details views' });
  fireEvent.click(within(details).getByRole('tab', { name: 'Resolution' }));
  expect(setSection).toHaveBeenLastCalledWith('Resolution');
});

it('refreshes the visible workspace in the background and pauses for the account dialog', async () => {
  vi.useFakeTimers();
  let refreshed = false;
  const invoke = vi.fn(async (command: { action: string }) => {
    if (command.action === 'refreshVisible') refreshed = true;
    return {
      success: true as const,
      data: {
        configured: true,
        status: 'connected' as const,
        queuePage: {
          queue: 'NOC' as const,
          page: 0,
          hasMore: false,
          tickets: [
            {
              ...ticket,
              subject: refreshed ? 'Refreshed subject' : ticket.subject,
            },
          ],
        },
        snapshot: {
          source: 'live' as const,
          fetchedAt: Date.now(),
          expiresAt: Date.now() + 300_000,
        },
      },
    };
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(screen.getByText(ticket.subject)).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'refreshVisible' });
  expect(screen.getByText('Refreshed subject')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Work Account$/ }));
  const calls = invoke.mock.calls.filter(([command]) => command.action === 'refreshVisible').length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(invoke.mock.calls.filter(([command]) => command.action === 'refreshVisible')).toHaveLength(
    calls,
  );
});

it('applies several statuses, keeps them across queues and restores them after a restart', async () => {
  localStorage.clear();
  const statuses = ['Open', 'On Hold', 'Closed'];
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readStandardOptions'
        ? {
            options: {
              field: command.field,
              hasMore: false,
              choices: statuses.map((name, index) => ({
                label: name,
                value: { id: String(index + 1), name },
              })),
            },
          }
        : {}),
      ...(command.action === 'readQueue'
        ? {
            queuePage: {
              queue: command.queue,
              page: command.page,
              hasMore: false,
              ...(command.filters ? { filters: command.filters } : {}),
              tickets: [{ ...ticket, group: command.queue }],
            },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const first = render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  const filters = screen.getByRole('form', { name: 'Queue filters' });
  fireEvent.click(within(filters).getByRole('button', { name: 'Status All' }));
  fireEvent.click(await within(filters).findByRole('checkbox', { name: 'Open' }));
  fireEvent.click(within(filters).getByRole('checkbox', { name: 'On Hold' }));
  expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ action: 'readStandardOptions' }));
  expect(within(filters).getByRole('button', { name: 'Status 2 selected' })).toBeVisible();
  fireEvent.keyDown(within(filters).getByRole('checkbox', { name: 'On Hold' }), {
    key: 'Escape',
  });
  expect(within(filters).queryByRole('checkbox', { name: 'Closed' })).not.toBeInTheDocument();
  expect(within(filters).getByText('Not applied')).toBeVisible();
  fireEvent.change(within(filters).getByRole('textbox', { name: 'Search queue' }), {
    target: { value: 'printer' },
  });
  fireEvent.click(within(filters).getByRole('button', { name: 'Apply Filters' }));
  const applied = { search: 'printer', status: ['On Hold', 'Open'] };
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      filters: applied,
    }),
  );
  await screen.findByText('1 ticket · Filtered by SDP');
  expect(within(filters).queryByText('Not applied')).not.toBeInTheDocument();
  // Search text is session-only; the status selection is remembered on this device.
  expect(JSON.parse(localStorage.getItem('relay:sdp-queue-filters:http://relay.test')!)).toEqual({
    status: ['On Hold', 'Open'],
  });
  fireEvent.click(screen.getByRole('button', { name: 'SOX' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'readQueue',
      queue: 'SOX',
      page: 0,
      filters: applied,
    }),
  );
  first.unmount();

  invoke.mockClear();
  render(<LiveSdpQueues />);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      filters: { status: ['On Hold', 'Open'] },
    }),
  );
  expect(await screen.findByRole('button', { name: 'Status 2 selected' })).toBeVisible();
  await screen.findByText('1 ticket · Filtered by SDP');
  expect(invoke.mock.calls.filter(([command]) => command.action === 'readQueue')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith({ action: 'readQueue', queue: 'NOC', page: 0 }),
  );
  expect(localStorage.getItem('relay:sdp-queue-filters:http://relay.test')).toBeNull();
});

it('shows who is signed in and offers Pick Up and Close Ticket on the ticket header', async () => {
  const unassigned = { ...ticket, technician: 'No technician' };
  let picked = false;
  const live = { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 };
  const loaded = () => ({
    configured: true,
    status: 'connected',
    queuePage: {
      queue: 'NOC',
      page: 0,
      hasMore: false,
      tickets: [picked ? { ...unassigned, technician: 'Example Person' } : unassigned],
    },
    snapshot: live,
    detail: {
      id: '123',
      includeAutoNotifications: false,
      properties: [],
      notes: [],
      description: '',
      page: 0,
      hasMore: false,
      conversations: [],
    },
    detailSnapshot: live,
  });
  const confirmationId = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'readAccount')
      return {
        success: true,
        data: { ...loaded(), account: { name: 'Example Person', email: 'person@example.test' } },
      };
    if (command.action === 'prepareChange')
      return {
        success: true,
        data: {
          ...loaded(),
          review: { confirmationId, expiresAt: Date.now() + 300000, mutation: command.mutation },
        },
      };
    if (command.action === 'confirmChange') {
      picked = true;
      return {
        success: true,
        data: { ...loaded(), changeResult: { id: '123', number: '810129', kind: 'pickup' } },
      };
    }
    return { success: true, data: loaded() };
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  expect(await screen.findByText('Example Person', { selector: 'strong' })).toBeVisible();
  expect(screen.getByText(/Signed in as/)).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic live subject/ }));
  const pane = screen.getByRole('complementary', { name: 'Ticket 810129' });
  await waitFor(() => expect(within(pane).getByRole('button', { name: 'Pick Up' })).toBeEnabled());
  fireEvent.click(within(pane).getByRole('button', { name: 'More Actions' }));
  expect(screen.getByRole('menuitem', { name: 'Refresh Ticket' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: /Resolve/ })).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(within(pane).getByRole('button', { name: 'Pick Up' }));
  const confirm = within(pane).getByRole('group', { name: 'Confirm pick up' });
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepareChange' }));
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm Pick Up' }));
  expect(await within(pane).findByText(/Picked up #810129/)).toBeVisible();
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'pickup', id: '123' },
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'confirmChange', confirmationId });
  expect(within(pane).queryByRole('button', { name: 'Pick Up' })).not.toBeInTheDocument();
  fireEvent.click(within(pane).getByRole('button', { name: 'Close Ticket' }));
  expect(screen.getByRole('dialog', { name: 'Close ticket' })).toBeVisible();
});

it('switches to the newest ticket while one loads, keeps it through a queue refresh and closes it from the queue', async () => {
  const second = { ...ticket, id: '124', number: '810130', subject: 'Second live subject' };
  const live = { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 };
  const page = {
    configured: true,
    status: 'connected',
    queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket, second] },
    snapshot: live,
  };
  const detailOf = (id: string) => ({
    ...page,
    detail: {
      id,
      includeAutoNotifications: false,
      properties: [],
      notes: [],
      description: `<p>Description ${id}</p>`,
      page: 0,
      hasMore: false,
      conversations: [],
    },
    detailSnapshot: live,
  });
  let releaseFirst!: () => void;
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'readDetail' && command.id === '123' && !releaseFirst) {
      await new Promise<void>((done) => {
        releaseFirst = done;
      });
      return { success: true, data: detailOf('123') };
    }
    if (command.action === 'readDetail') return { success: true, data: detailOf(command.id) };
    return { success: true, data: page };
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic live subject/ }));
  await waitFor(() => expect(releaseFirst).toBeDefined());
  // The queue stays usable while the first ticket loads; the newest choice wins.
  fireEvent.click(screen.getByRole('button', { name: /Second live subject/ }));
  expect(screen.getByRole('complementary', { name: 'Ticket 810130' })).toBeVisible();
  releaseFirst();
  expect(await screen.findByText('Description 124')).toBeInTheDocument();
  expect(screen.queryByText('Description 123')).not.toBeInTheDocument();
  // Refresh Queue keeps the open ticket and reads it again.
  invoke.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Queue' }));
  expect(screen.getByRole('complementary', { name: 'Ticket 810130' })).toBeVisible();
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({ action: 'readDetail', id: '124', page: 0 }),
  );
  expect(screen.getByRole('complementary', { name: 'Ticket 810130' })).toBeVisible();
  // Clicking the open row again, or empty queue space, closes the ticket.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Second live subject/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: /Second live subject/ }));
  expect(screen.queryByRole('complementary', { name: 'Ticket 810130' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Synthetic live subject/ }));
  expect(await screen.findByText('Description 123')).toBeInTheDocument();
  fireEvent.click(screen.getByText('2 tickets'));
  expect(screen.queryByRole('complementary', { name: 'Ticket 810129' })).not.toBeInTheDocument();
});

it('marks queue rows with SDP conversation status and notes, as SDP’s list view does', async () => {
  const rows = [
    { ...ticket, id: '1', number: '1', subject: 'Quiet', notificationStatus: null },
    { ...ticket, id: '2', number: '2', subject: 'Answered', notificationStatus: 'TECH_REPLY' },
    {
      ...ticket,
      id: '3',
      number: '3',
      subject: 'Waiting',
      notificationStatus: 'REQ_REPLY',
      unrepliedCount: 2,
    },
  ];
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readQueue'
        ? {
            queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: rows },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
      ...(command.action === 'readQueueNotes'
        ? { queueNotes: { queue: 'NOC', page: 0, ids: ['2'] } }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  expect(
    await screen.findByRole('button', { name: 'Open ticket 1: Quiet. No replies' }),
  ).toBeTruthy();
  expect(
    await screen.findByRole('button', {
      name: 'Open ticket 2: Answered. Technician replied, has notes',
    }),
  ).toBeTruthy();
  const waiting = screen.getByRole('button', {
    name: 'Open ticket 3: Waiting. 2 requester replies waiting',
  });
  expect(waiting.querySelector('.sdp-row-flag.is-requester')).toHaveTextContent('2');
  expect(invoke).toHaveBeenCalledWith({ action: 'readQueueNotes', queue: 'NOC', page: 0 });
});
it('marks VIP requesters with a purple VIP badge, lists them first and counts them', async () => {
  const rows = [
    { ...ticket, id: '1', number: '1', subject: 'Routine' },
    { ...ticket, id: '2', number: '2', subject: 'Executive laptop', vip: true as const },
    { ...ticket, id: '3', number: '3', subject: 'Printer' },
  ];
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readQueue'
        ? {
            queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: rows },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  const vip = await screen.findByRole('button', {
    name: /^Open ticket 2: Executive laptop\. VIP requester/,
  });
  expect(within(vip).getByText('VIP')).toHaveClass('sdp-vip-badge');
  const list = screen.getByRole('region', { name: 'Live tickets in queue' });
  expect(
    within(list)
      .getAllByRole('button', { name: /^Open ticket/ })
      .map((row) => row.getAttribute('aria-label')?.split(':')[0]),
  ).toEqual(['Open ticket 2', 'Open ticket 1', 'Open ticket 3']);
  const overview = screen.getByRole('region', { name: 'Status counts on this page' });
  expect(within(overview).getByText('VIP requesters').nextSibling).toHaveTextContent('1');
});
it('shows when each queue ticket was created in local 12-hour time instead of its due time', async () => {
  const year = new Date().getFullYear();
  const rows = [
    {
      ...ticket,
      id: '1',
      number: '1',
      subject: 'Recent',
      createdAt: new Date(year, 9, 6, 12, 12).getTime(),
      dueAt: Date.now() - 60_000,
    },
    {
      ...ticket,
      id: '2',
      number: '2',
      subject: 'Old',
      createdAt: new Date(2020, 0, 2, 9, 5).getTime(),
    },
    { ...ticket, id: '3', number: '3', subject: 'Unknown', createdAt: null },
  ];
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readQueue'
        ? {
            queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: rows },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 1: Recent/ });
  expect(screen.getByRole('columnheader', { name: 'Created' })).toBeTruthy();
  expect(screen.queryByRole('columnheader', { name: 'Due' })).toBeNull();
  const cell = (number: string) =>
    screen.getByRole('button', { name: new RegExp(`Open ticket ${number}:`) }).closest('tr')
      ?.lastElementChild;
  expect(cell('1')).toHaveTextContent(/^Oct 6, 12:12\sPM$/);
  expect(cell('1')).not.toHaveTextContent('Overdue');
  expect(cell('2')).toHaveTextContent(/^Jan 2, 2020, 9:05\sAM$/);
  expect(cell('3')).toHaveTextContent('Not set');
  expect(cell('1')?.querySelector('time')).toHaveAttribute(
    'datetime',
    new Date(year, 9, 6, 12, 12).toISOString(),
  );
});

function queueApi(
  rows: (typeof ticket)[],
  extra: (command: { action: string }) => object = () => ({}),
) {
  return vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readQueue'
        ? {
            queuePage: {
              queue: command.queue,
              page: command.page,
              ...(command.pageSize ? { pageSize: command.pageSize } : {}),
              ...(command.sort ? { sort: command.sort } : {}),
              hasMore: false,
              tickets: rows.map((row) => ({ ...row, group: command.queue })),
            },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
      ...extra(command),
    },
  }));
}

it('checks every row on the page from the header and offers one reviewed bulk update', async () => {
  localStorage.clear();
  const rows = Array.from({ length: 3 }, (_, i) => ({
    ...ticket,
    id: String(i + 1),
    number: String(i + 1),
    subject: `Row ${i + 1}`,
  }));
  const invoke = queueApi(rows);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 1:/ });
  expect(screen.queryByRole('button', { name: 'Select Page' })).not.toBeInTheDocument();
  const all = screen.getByRole('checkbox', { name: 'Select all tickets on this page' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select ticket 2' }));
  expect((all as HTMLInputElement).indeterminate).toBe(true);
  fireEvent.click(all);
  for (const n of ['1', '2', '3'])
    expect(screen.getByRole('checkbox', { name: `Select ticket ${n}` })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Update Selected (3)' })).toBeEnabled();
  // Cancelling the update keeps the selection to adjust and try again.
  fireEvent.click(screen.getByRole('button', { name: 'Update Selected (3)' }));
  const dialog = await screen.findByRole('dialog', { name: 'Update selected tickets' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Update Selected (3)' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Select ticket 2' })).toBeChecked();
  fireEvent.click(all);
  expect(screen.getByRole('checkbox', { name: 'Select ticket 1' })).not.toBeChecked();
  expect(screen.queryByRole('button', { name: /Update Selected/ })).not.toBeInTheDocument();
});

it('reads larger pages on request and remembers the size on this device', async () => {
  localStorage.clear();
  const invoke = queueApi([ticket]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const view = render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 810129:/ });
  // The default size is never sent, so older servers keep answering.
  expect(invoke).toHaveBeenCalledWith({ action: 'readQueue', queue: 'NOC', page: 0 });
  fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), {
    target: { value: '100' },
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      pageSize: 100,
    }),
  );
  expect(localStorage.getItem('relay:sdp-page-size:http://relay.test')).toBe('100');
  view.unmount();
  render(<LiveSdpQueues />);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('100'),
  );
});

it('sorts the queue in SDP from the column headers and remembers the order on this device', async () => {
  localStorage.clear();
  const invoke = queueApi([ticket]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const view = render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 810129:/ });
  const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });
  expect(header('Created')).toHaveAttribute('aria-sort', 'descending');
  expect(header('Priority')).not.toHaveAttribute('aria-sort');
  expect(screen.queryByRole('button', { name: 'Last reply' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      sort: { field: 'priority', order: 'asc' },
    }),
  );
  await waitFor(() => expect(header('Priority')).toHaveAttribute('aria-sort', 'ascending'));
  expect(header('Created')).not.toHaveAttribute('aria-sort');
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
  await waitFor(() => expect(header('Priority')).toHaveAttribute('aria-sort', 'descending'));
  expect(JSON.parse(localStorage.getItem('relay:sdp-queue-sort:http://relay.test')!)).toEqual({
    field: 'priority',
    order: 'desc',
  });
  view.unmount();
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { field: 'priority', order: 'desc' } }),
    ),
  );
  // Created starts oldest first; its second click is newest first, the default that is never sent.
  fireEvent.click(await screen.findByRole('button', { name: 'Created' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { field: 'created', order: 'asc' } }),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Created' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith({ action: 'readQueue', queue: 'NOC', page: 0 }),
  );
  expect(localStorage.getItem('relay:sdp-queue-sort:http://relay.test')).toBeNull();
});

it('tints rows by main status with colors chosen on this device', async () => {
  localStorage.clear();
  localStorage.setItem(
    'relay:sdp-status-colors:http://relay.test',
    '{"Canceled":"#00ff00","Open":"teal"}',
  );
  const invoke = queueApi([
    { ...ticket, status: 'Waiting for Feedback' },
    { ...ticket, id: '2', number: '2', subject: 'Second', status: 'Open' },
    { ...ticket, id: '3', number: '3', subject: 'Third', status: 'Canceled' },
  ]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  const waiting = await screen.findByRole('button', { name: /Open ticket 810129:/ });
  expect(waiting.closest('tr')).not.toHaveClass('sdp-tinted-row');
  fireEvent.click(screen.getByRole('button', { name: 'Row Colors' }));
  const dialog = await screen.findByRole('dialog', { name: 'Row colors' });
  expect(
    within(dialog)
      .getAllByRole('group')
      .map((group) => group.querySelector('legend')?.textContent),
  ).toEqual(['Open', 'In Progress', 'Waiting', 'On Hold', 'Closed']);
  // Focus opens on the first status's current choice, not its custom color picker.
  await waitFor(() =>
    expect(
      within(within(dialog).getByRole('group', { name: 'Open' })).getByRole('radio', {
        name: 'No color',
      }),
    ).toHaveFocus(),
  );
  fireEvent.click(
    within(within(dialog).getByRole('group', { name: 'Waiting' })).getByRole('radio', {
      name: 'Red',
    }),
  );
  fireEvent.change(within(dialog).getByLabelText('Custom color for Open'), {
    target: { value: '#123ABC' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Colors' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const row = screen.getByRole('button', { name: /Open ticket 810129:/ }).closest('tr')!;
  expect(row).toHaveClass('sdp-tinted-row');
  expect(row.style.getPropertyValue('--sdp-row-tint')).not.toBe('');
  expect(row.style.getPropertyValue('--sdp-row-tint')).toBe('#e63946');
  const open = screen.getByRole('button', { name: /Open ticket 2:/ }).closest('tr')!;
  expect(open.style.getPropertyValue('--sdp-row-tint')).toBe('#123abc');
  expect(screen.getByRole('button', { name: /Open ticket 3:/ }).closest('tr')).not.toHaveClass(
    'sdp-tinted-row',
  );
  expect(
    within(screen.getByRole('list', { name: 'Row colors' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Open', 'Waiting']);
  expect(JSON.parse(localStorage.getItem('relay:sdp-status-colors:http://relay.test')!)).toEqual({
    Open: '#123abc',
    Waiting: '#e63946',
  });
});

it('reorders, removes and adds queue tabs, saved on this device', async () => {
  localStorage.clear();
  const invoke = queueApi([ticket], (command) =>
    command.action === 'readStandardOptions'
      ? {
          options: {
            field: 'group',
            hasMore: false,
            choices: [{ value: { id: '9', name: 'Network Ops' }, label: 'Network Ops' }],
          },
        }
      : {},
  );
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(
    within(screen.getByRole('toolbar', { name: 'Live ticket actions' })).getByRole('button', {
      name: 'Manage Queues',
    }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Manage queues' });
  expect(within(dialog).getByText('3 of 10')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Move NOC up' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Move SOX up' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Unassigned' }));
  const group = within(dialog).getByRole('combobox', { name: 'Support group' });
  fireEvent.focus(group);
  await within(dialog).findByRole('option', { name: 'Network Ops' });
  fireEvent.change(group, { target: { value: 'Network Ops' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add Queue' }));
  expect(within(dialog).getByRole('button', { name: 'Add Unassigned' })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Queues' }));
  const nav = screen.getByRole('navigation', { name: 'Live SDP queues' });
  expect(
    within(nav)
      .getAllByRole('button')
      .map((tab) => tab.textContent),
  ).toEqual(['SOX', 'NOC', 'Network Ops']);
  expect(JSON.parse(localStorage.getItem('relay:sdp-queues:http://relay.test')!)).toEqual([
    'SOX',
    'NOC',
    'Network Ops',
  ]);
  fireEvent.click(within(nav).getByRole('button', { name: 'Network Ops' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({ action: 'readQueue', queue: 'Network Ops', page: 0 }),
  );
});

it('searches all of SDP, opens a result in the workspace and returns to the queue', async () => {
  localStorage.clear();
  const found = { ...ticket, id: '777', number: '820001', subject: 'Printer offline' };
  const invoke = queueApi([ticket], (command) => {
    if (command.action === 'searchTickets')
      return {
        ticketSearch: {
          query: 'printer',
          page: 0,
          hasMore: false,
          tickets: [{ ...found, group: 'Field Services' }],
        },
      };
    if (command.action === 'readDetail')
      return {
        detail: {
          id: '777',
          page: 0,
          description: '<p>Paper jam</p>',
          conversations: [],
          hasMore: false,
        },
        detailSnapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
      };
    return {};
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  // The search button appears once there is something to search for.
  expect(screen.queryByRole('button', { name: 'Search SDP' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search all SDP tickets' }), {
    target: { value: ' printer ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search SDP' }));
  const results = await screen.findByRole('region', { name: 'SDP search results' });
  expect(invoke).toHaveBeenCalledWith({ action: 'searchTickets', query: 'printer', page: 0 });
  expect(await within(results).findByText('Field Services')).toBeInTheDocument();
  expect(
    within(results).getByText('Showing 1 SDP ticket that matches “printer”'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Live tickets in queue' })).not.toBeInTheDocument();
  fireEvent.click(
    within(results).getByRole('button', { name: 'Open ticket 820001: Printer offline' }),
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({ action: 'readDetail', id: '777', page: 0 }),
  );
  expect(await screen.findByText('Paper jam')).toBeInTheDocument();
  fireEvent.click(within(results).getByRole('button', { name: 'Back to Queue' }));
  expect(screen.queryByRole('region', { name: 'SDP search results' })).not.toBeInTheDocument();
});

it('starts an SDP-wide search from a ⌘K request and explains when the server needs an update', async () => {
  localStorage.clear();
  const invoke = vi
    .fn()
    .mockImplementation(async (command) =>
      command.action === 'searchTickets'
        ? { success: false, error: 'The Relay server needs an update for this action.' }
        : { success: true, data: { configured: true, status: 'connected' } },
    );
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(
    <LiveSdpQueues
      request={{ destination: 'ticket', source: 'sdp', search: 'vpn', sequence: 1 }}
    />,
  );
  expect(
    await screen.findByText('The Relay server needs an update to search all of SDP.'),
  ).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith({ action: 'searchTickets', query: 'vpn', page: 0 });
  expect(screen.getByRole('searchbox', { name: 'Search all SDP tickets' })).toHaveValue('vpn');
});
