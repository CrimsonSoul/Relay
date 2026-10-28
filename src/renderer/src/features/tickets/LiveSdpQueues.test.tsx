import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { SdpBody } from './SdpBody';
import { SdpTicketContent } from './SdpTicketContent';
import { LiveSdpQueues } from './LiveSdpQueues';
import { chooseSdpOption } from './sdpPicker.test-util';
import { Activity, type ReactNode } from 'react';

// These tests render full queues (up to 120 rows) through the real picker and selection flows;
// under CI coverage instrumentation they can pass the 5 s default, so they get the same 20 s budget
// as other full-surface renderer tests.
vi.setConfig({ testTimeout: 20_000 });

/** The freshness readout by its whole text; its caption, time and note are separate spans. */
const readout = (text: string | RegExp) => (_content: string, element: Element | null) =>
  !!element?.classList.contains('tab-freshness') &&
  (typeof text === 'string' ? element.textContent === text : text.test(element.textContent ?? ''));
/**
 * The latest queue read. Notes and background refreshes follow each read on their own timers, so the
 * mock's last call overall can already be one of those by the time an assertion looks.
 */
const lastQueueRead = (invoke: ReturnType<typeof vi.fn>) =>
  invoke.mock.calls.findLast(([command]) => command.action === 'readQueue')?.[0];
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
  fireEvent.click(screen.getByRole('button', { name: /^Load \d+ More$/ }));
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
  expect(screen.queryByRole('button', { name: /^Load \d+ More$/ })).not.toBeInTheDocument();
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

it('expands the open ticket to fill the tab with F or Expand and remembers it on this device', async () => {
  localStorage.clear();
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket] },
      snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
      ...(command.action === 'readDetail'
        ? {
            detail: { id: command.id, description: '', page: 0, hasMore: false, conversations: [] },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const { container, unmount } = render(<LiveSdpQueues />);
  const row = await screen.findByRole('button', { name: /Synthetic live subject/ });
  // Each row lists the ticket's group beside its status and technician.
  expect(
    screen.getByRole('button', { name: 'Change group for ticket 810129, currently NOC' }),
  ).toBeVisible();
  await waitFor(() => expect(row).toBeEnabled());
  // F does nothing without an open ticket.
  fireEvent.keyDown(document.body, { key: 'f' });
  expect(localStorage.getItem('relay:sdp-ticket-expanded')).toBeNull();
  fireEvent.click(row);
  await screen.findByRole('complementary', { name: 'Ticket 810129' });
  // Tickets open expanded until the person collapses one.
  const tab = container.querySelector('.tickets-tab')!;
  expect(tab).toHaveClass('is-ticket-expanded');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
  expect(tab).not.toHaveClass('is-ticket-expanded');
  expect(localStorage.getItem('relay:sdp-ticket-expanded')).toBe('false');
  fireEvent.keyDown(document.body, { key: 'f' });
  expect(tab).toHaveClass('is-ticket-expanded');
  expect(screen.getByRole('button', { name: 'Collapse' })).toBeVisible();
  expect(localStorage.getItem('relay:sdp-ticket-expanded')).toBeNull();
  fireEvent.keyDown(document.body, { key: 'f' });
  unmount();
  // The collapsed choice holds after a restart.
  const again = render(<LiveSdpQueues />);
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic live subject/ }));
  await screen.findByRole('complementary', { name: 'Ticket 810129' });
  expect(again.container.querySelector('.tickets-tab')).not.toHaveClass('is-ticket-expanded');
  expect(screen.getByRole('button', { name: 'Expand' })).toBeVisible();
  localStorage.clear();
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
    await vi.advanceTimersByTimeAsync(119_000);
  });
  expect(invoke).not.toHaveBeenCalledWith({ action: 'refreshVisible' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'refreshVisible' });
  expect(screen.getByText('Refreshed subject')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Work Account$/ }));
  const calls = invoke.mock.calls.filter(([command]) => command.action === 'refreshVisible').length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
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
  expect(within(filters).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('button', { name: 'Filters' }));
  fireEvent.click(within(filters).getByRole('button', { name: 'Status All' }));
  fireEvent.click(await within(filters).findByRole('checkbox', { name: 'Open' }));
  fireEvent.click(within(filters).getByRole('checkbox', { name: 'On Hold' }));
  expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ action: 'readStandardOptions' }));
  expect(within(filters).getByRole('button', { name: 'Status 2 selected' })).toBeVisible();
  fireEvent.keyDown(within(filters).getByRole('checkbox', { name: 'On Hold' }), {
    key: 'Escape',
  });
  expect(within(filters).queryByRole('checkbox', { name: 'Closed' })).not.toBeInTheDocument();
  // Closing the list applies both picks in one read.
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      filters: { status: ['On Hold', 'Open'] },
    }),
  );
  await screen.findByText('1 ticket · Filtered by SDP');
  const search = within(filters).getByRole('searchbox', { name: 'Search queue' });
  fireEvent.change(search, { target: { value: 'printer' } });
  fireEvent.submit(search);
  const applied = { search: 'printer', status: ['On Hold', 'Open'] };
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      filters: applied,
    }),
  );
  expect(within(filters).getByRole('button', { name: 'Filters · 1' })).toBeVisible();
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
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await waitFor(() =>
    expect(lastQueueRead(invoke)).toEqual({ action: 'readQueue', queue: 'NOC', page: 0 }),
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

it('opens Add Note, Edit and Close Ticket with N, E and C, and stamps a closed ticket', async () => {
  let status = 'Open';
  const live = { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 };
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [{ ...ticket, status }] },
      snapshot: live,
      ...(command.action === 'readDetail'
        ? {
            detail: {
              id: command.id,
              properties: [],
              notes: [],
              description: '',
              page: 0,
              hasMore: false,
              conversations: [],
            },
            detailSnapshot: live,
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const { unmount } = render(<LiveSdpQueues />);
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic live subject/ }));
  const pane = await screen.findByRole('complementary', { name: 'Ticket 810129' });
  await waitFor(() =>
    expect(within(pane).getByRole('button', { name: 'Close Ticket' })).toBeEnabled(),
  );
  expect(within(pane).queryByLabelText(/This ticket is/)).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'n' });
  const note = screen.getByRole('dialog', { name: 'Add note' });
  fireEvent.click(within(note).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.keyDown(document.body, { key: 'c' });
  const close = screen.getByRole('dialog', { name: 'Close ticket' });
  fireEvent.click(within(close).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.keyDown(document.body, { key: 'e' });
  expect(await within(pane).findByRole('button', { name: 'Cancel' })).toBeVisible();
  unmount();

  // A closed ticket wears its stamp and cannot be closed again, by button or by C.
  status = 'Closed';
  render(<LiveSdpQueues />);
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic live subject/ }));
  const closed = await screen.findByRole('complementary', { name: 'Ticket 810129' });
  expect(within(closed).getByLabelText('This ticket is closed')).toHaveTextContent('Closed');
  await waitFor(() =>
    expect(within(closed).getByRole('button', { name: 'Add Note' })).toBeEnabled(),
  );
  expect(within(closed).getByRole('button', { name: 'Close Ticket' })).toBeDisabled();
  fireEvent.keyDown(document.body, { key: 'c' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    await screen.findByRole('button', { name: 'Open ticket 1: Quiet. Low priority, No replies' }),
  ).toBeTruthy();
  expect(
    await screen.findByRole('button', {
      name: 'Open ticket 2: Answered. Low priority, Technician replied, has notes',
    }),
  ).toBeTruthy();
  const waiting = screen.getByRole('button', {
    name: 'Open ticket 3: Waiting. Low priority, 2 requester replies waiting',
  });
  expect(waiting.closest('li')!.querySelector('.sdp-row-flag.is-requester')).toHaveTextContent('2');
  expect(invoke).toHaveBeenCalledWith({ action: 'readQueueNotes', queue: 'NOC', page: 0 });
});
it('marks VIP requesters with a purple crown beside the requester, lists them first and counts them', async () => {
  const rows = [
    { ...ticket, id: '1', number: '1', subject: 'Routine' },
    {
      ...ticket,
      id: '2',
      number: '2',
      subject: 'Executive laptop',
      vip: true as const,
      requesterName: 'Dana Example',
    },
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
    name: /^Open ticket 2: Executive laptop\. Low priority, VIP requester/,
  });
  // The crown sits beside the requester's name on the row's context line.
  const requester = vip.closest('li')!.querySelector<HTMLElement>('.sdp-row-requester')!;
  expect(within(requester).getByRole('img', { name: 'VIP requester' })).toHaveClass('sdp-vip-flag');
  expect(within(vip).queryByText('VIP')).toBeNull();
  const list = screen.getByRole('region', { name: 'Live tickets in queue' });
  expect(
    within(list)
      .getAllByRole('button', { name: /^Open ticket/ })
      .map((row) => row.getAttribute('aria-label')?.split(':')[0]),
  ).toEqual(['Open ticket 2', 'Open ticket 1', 'Open ticket 3']);
  expect(within(list).getByText('3 tickets · 1 VIP')).toBeInTheDocument();
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
  // The row's top-right slot is the created time; the queue shows no due time.
  const cell = (number: string) =>
    screen
      .getByRole('button', { name: new RegExp(`Open ticket ${number}:`) })
      .closest('li')
      ?.querySelector('.sdp-queue-row__time');
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Rows per load' }), {
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
    expect(screen.getByRole('combobox', { name: 'Rows per load' })).toHaveValue('100'),
  );
});

it('sorts the queue in SDP from the Sort queue select and remembers the order on this device', async () => {
  localStorage.clear();
  const invoke = queueApi([ticket]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const view = render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 810129:/ });
  const order = () => screen.getByRole('combobox', { name: 'Sort queue' });
  expect(order()).toHaveValue('newest');
  fireEvent.change(order(), { target: { value: 'status-asc' } });
  await waitFor(() =>
    expect(lastQueueRead(invoke)).toEqual({
      action: 'readQueue',
      queue: 'NOC',
      page: 0,
      sort: { field: 'status', order: 'asc' },
    }),
  );
  fireEvent.change(order(), { target: { value: 'status-desc' } });
  await waitFor(() => expect(order()).toHaveValue('status-desc'));
  expect(JSON.parse(localStorage.getItem('relay:sdp-queue-sort:http://relay.test')!)).toEqual({
    field: 'status',
    order: 'desc',
  });
  view.unmount();
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await waitFor(() =>
    expect(lastQueueRead(invoke)).toEqual(
      expect.objectContaining({ sort: { field: 'status', order: 'desc' } }),
    ),
  );
  await waitFor(() => expect(order()).toHaveValue('status-desc'));
  fireEvent.change(order(), { target: { value: 'created-asc' } });
  await waitFor(() =>
    expect(lastQueueRead(invoke)).toEqual(
      expect.objectContaining({ sort: { field: 'created', order: 'asc' } }),
    ),
  );
  // Newest first is the default and is never sent.
  fireEvent.change(order(), { target: { value: 'newest' } });
  await waitFor(() =>
    expect(lastQueueRead(invoke)).toEqual({ action: 'readQueue', queue: 'NOC', page: 0 }),
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
  expect(waiting.closest('li')).not.toHaveClass('sdp-tinted-row');
  fireEvent.click(screen.getByRole('button', { name: 'Row Colors' }));
  const dialog = await screen.findByRole('dialog', { name: 'Row colors' });
  expect(
    within(dialog)
      .getAllByRole('group')
      .map((group) => group.querySelector('legend')?.textContent),
  ).toEqual(['Strength', 'Open', 'In Progress', 'Waiting', 'On Hold', 'Closed']);
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
  const row = screen.getByRole('button', { name: /Open ticket 810129:/ }).closest('li')!;
  expect(row).toHaveClass('sdp-tinted-row');
  expect(row.style.getPropertyValue('--sdp-row-tint')).not.toBe('');
  expect(row.style.getPropertyValue('--sdp-row-tint')).toBe('#e63946');
  const open = screen.getByRole('button', { name: /Open ticket 2:/ }).closest('li')!;
  expect(open.style.getPropertyValue('--sdp-row-tint')).toBe('#123abc');
  expect(screen.getByRole('button', { name: /Open ticket 3:/ }).closest('li')).not.toHaveClass(
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
  expect(row.closest('ul')).not.toHaveClass('has-vibrant-rows');
});

it('switches row colors between the subtle and vibrant wash, previewed until saved', async () => {
  localStorage.clear();
  localStorage.setItem('relay:sdp-status-colors:http://relay.test', '{"Open":"#22c55e"}');
  const strengthKey = 'relay:sdp-row-color-strength:http://relay.test';
  const invoke = queueApi([{ ...ticket, status: 'Open' }]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  const table = (await screen.findByRole('button', { name: /Open ticket 810129:/ })).closest('ul')!;
  expect(table).not.toHaveClass('has-vibrant-rows');
  fireEvent.click(screen.getByRole('button', { name: 'Row Colors' }));
  let dialog = await screen.findByRole('dialog', { name: 'Row colors' });
  const strength = within(dialog).getByRole('group', { name: 'Strength' });
  expect(within(strength).getByRole('button', { name: 'Subtle', pressed: true })).toBeVisible();
  // The dialog previews each colored status's row at the chosen strength.
  const preview = within(dialog).getByRole('group', { name: 'Open' }).closest('li')!;
  expect(preview).toHaveClass('sdp-tinted-row');
  expect(preview.closest('ul')).not.toHaveClass('has-vibrant-rows');
  fireEvent.click(within(strength).getByRole('button', { name: 'Vibrant' }));
  expect(within(strength).getByRole('button', { name: 'Vibrant', pressed: true })).toBeVisible();
  expect(preview.closest('ul')).toHaveClass('has-vibrant-rows');
  // Cancel leaves the queue as it was.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(table).not.toHaveClass('has-vibrant-rows');
  expect(localStorage.getItem(strengthKey)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Row Colors' }));
  dialog = await screen.findByRole('dialog', { name: 'Row colors' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Vibrant' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Colors' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(table).toHaveClass('has-vibrant-rows');
  expect(localStorage.getItem(strengthKey)).toBe('vibrant');
  // Back to subtle clears the saved choice.
  fireEvent.click(screen.getByRole('button', { name: 'Row Colors' }));
  dialog = await screen.findByRole('dialog', { name: 'Row colors' });
  expect(within(dialog).getByRole('button', { name: 'Vibrant', pressed: true })).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Subtle' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save Colors' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(table).not.toHaveClass('has-vibrant-rows');
  expect(localStorage.getItem(strengthKey)).toBeNull();
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
  await chooseSdpOption(
    within(dialog).getByRole('combobox', { name: 'Support group' }),
    'Network Ops',
  );
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

it('remembers an order saved by priority, as the sort menu offers it', async () => {
  localStorage.clear();
  localStorage.setItem(
    'relay:sdp-queue-sort:http://relay.test',
    JSON.stringify({ field: 'priority', order: 'asc' }),
  );
  const invoke = queueApi([ticket]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 810129:/ });
  expect(lastQueueRead(invoke)).toEqual({
    action: 'readQueue',
    queue: 'NOC',
    page: 0,
    sort: { field: 'priority', order: 'asc' },
  });
  expect(screen.getByRole('combobox', { name: 'Sort queue' })).toHaveDisplayValue(
    'Priority, A to Z',
  );
});

it('names requesters, shows priority beside the reply and notes icons and shows a queue’s earlier rows while it reloads', async () => {
  localStorage.clear();
  const rows: Record<string, (typeof ticket & { requesterName?: string })[]> = {
    NOC: [{ ...ticket, priority: 'High', requesterName: 'Avery Example' }],
    SOX: [{ ...ticket, id: '2', number: '2', subject: 'Audit request', group: 'SOX' }],
  };
  let hold: Promise<void> | undefined;
  let release = () => {};
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'readQueue' && command.queue === 'NOC' && hold) await hold;
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        ...(command.action === 'readQueue'
          ? {
              queuePage: {
                queue: command.queue,
                page: 0,
                hasMore: false,
                tickets: rows[command.queue],
              },
              snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
            }
          : {}),
      },
    };
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  const open = await screen.findByRole('button', {
    name: 'Open ticket 810129: Synthetic live subject. High priority',
  });
  const row = open.closest('li')!;
  expect(within(row).getByText('Avery Example')).toBeVisible();
  // Priority reads as signal bars among the row's icons: High fills three of four, tinted.
  const bars = row.querySelector('.sdp-row-flags .sdp-priority-flag')!;
  expect(bars).toHaveClass('is-level-3');
  expect(bars).toHaveAttribute('title', 'High priority');
  expect(within(row).queryByText('High')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'SOX' }));
  await screen.findByRole('button', { name: /^Open ticket 2: Audit request/ });
  // Back on NOC, its rows from earlier show (locked) while SDP answers, not SOX's.
  hold = new Promise<void>((resolve) => (release = resolve));
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  expect(await screen.findByText('Updating NOC queue…')).toBeVisible();
  expect(screen.getByRole('button', { name: /^Open ticket 810129:/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /^Open ticket 2:/ })).toBeNull();
  release();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Open ticket 810129:/ })).toBeEnabled(),
  );
  expect(screen.queryByText('Updating NOC queue…')).toBeNull();
});

it('loads more rows below the loaded ones and keeps their ticks', async () => {
  localStorage.clear();
  const row = (id: string, subject = `Row ${id}`) => ({ ...ticket, id, number: id, subject });
  const pages = [
    { tickets: [row('1'), row('2')], hasMore: true },
    { tickets: [row('2', 'Row 2 updated'), row('3')], hasMore: false },
  ];
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readQueue'
        ? {
            queuePage: {
              queue: command.queue,
              page: command.page,
              ...pages[command.page],
              tickets: pages[command.page]!.tickets.map((item) => ({
                ...item,
                group: command.queue,
              })),
            },
            snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByText('2 tickets · More in SDP');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select ticket 1' }));
  fireEvent.click(screen.getByRole('button', { name: /^Load \d+ More$/ }));
  await screen.findByText('3 tickets');
  expect(invoke).toHaveBeenCalledWith({ action: 'readQueue', queue: 'NOC', page: 1 });
  // A row both pages list shows once, in its earlier place, with the newer copy.
  const subjects = screen
    .getAllByRole('button', { name: /^Open ticket / })
    .map((button) => button.getAttribute('aria-label'));
  expect(subjects).toEqual([
    expect.stringContaining('Row 1'),
    expect.stringContaining('Row 2 updated'),
    expect.stringContaining('Row 3'),
  ]);
  expect(screen.getByRole('checkbox', { name: 'Select ticket 1' })).toBeChecked();
  expect(screen.queryByRole('button', { name: /^Load \d+ More$/ })).not.toBeInTheDocument();
  // Refresh Queue starts the list again from its first page.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Queue' }));
  await screen.findByText('2 tickets · More in SDP');
});

/** The tab's retained panel, as App keeps Tickets mounted while another tab shows. */
function Retained({ visible, children }: Readonly<{ visible: boolean; children: ReactNode }>) {
  return <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>;
}
const pagedRow = (id: string) => ({ ...ticket, id, number: id, subject: `Row ${id}` });
function pagedQueue(pages: { tickets: (typeof ticket)[]; hasMore: boolean }[]) {
  return vi.fn().mockImplementation(async (command) => {
    if (command.action === 'readQueue' && !pages[command.page])
      throw new Error('Relay unreachable');
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        ...(command.action === 'readQueue'
          ? {
              queuePage: {
                queue: command.queue,
                page: command.page,
                hasMore: pages[command.page]!.hasMore,
                tickets: pages[command.page]!.tickets.map((item) => ({
                  ...item,
                  group: command.queue,
                })),
              },
              snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
            }
          : {}),
      },
    };
  });
}

it('finishes a queue read that returns while Tickets is hidden', async () => {
  localStorage.clear();
  // Like the server, every answer (status checks included) carries the current queue page.
  const answer = queueApi([ticket]);
  let hold: Promise<void> | undefined;
  let release = () => {};
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'readQueue' && hold) await hold;
    return answer({ queue: 'NOC', page: 0, ...command, action: 'readQueue' });
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const view = render(
    <Retained visible>
      <LiveSdpQueues />
    </Retained>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 810129:/ });
  hold = new Promise((resolve) => (release = resolve));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Queue' }));
  expect(await screen.findByRole('button', { name: 'Loading…' })).toBeInTheDocument();
  view.rerender(
    <Retained visible={false}>
      <LiveSdpQueues />
    </Retained>,
  );
  await act(async () => {
    release();
    await hold;
  });
  hold = undefined;
  view.rerender(
    <Retained visible>
      <LiveSdpQueues />
    </Retained>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Queue' })).toBeEnabled());
  expect(screen.getByRole('button', { name: /Open ticket 810129:/ })).toBeEnabled();
  // The signed-in name is read once per sign-in, not again each time the tab shows.
  const accountReads = invoke.mock.calls.filter(([command]) => command.action === 'readAccount');
  expect(accountReads).toHaveLength(1);
});

it('updates rows from earlier pages too, and keeps every loaded row when Load More fails', async () => {
  localStorage.clear();
  const invoke = pagedQueue([
    { tickets: [pagedRow('1'), pagedRow('2')], hasMore: true },
    { tickets: [pagedRow('3')], hasMore: true },
  ]);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByText('2 tickets · More in SDP');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select ticket 1' }));
  fireEvent.click(screen.getByRole('button', { name: /^Load \d+ More$/ }));
  await screen.findByText('3 tickets · More in SDP');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select ticket 3' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update Selected (2)' }));
  const dialog = await screen.findByRole('dialog', { name: 'Update selected tickets' });
  expect(
    within(dialog)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['#1 — Row 1', '#3 — Row 3']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^Load \d+ More$/ }));
  await screen.findByRole('alert');
  expect(invoke).toHaveBeenCalledWith({ action: 'readQueue', queue: 'NOC', page: 2 });
  expect(screen.getAllByRole('button', { name: /^Open ticket / })).toHaveLength(3);
  expect(screen.getByText('3 tickets · More in SDP')).toBeInTheDocument();
});

it('clears a page selection held at the bulk limit from the header checkbox', async () => {
  localStorage.clear();
  const rows = Array.from({ length: 120 }, (_, i) => pagedRow(String(i + 1)));
  const invoke = queueApi(rows);
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await screen.findByRole('button', { name: /Open ticket 120:/ });
  const all = screen.getByRole('checkbox', { name: 'Select all tickets on this page' });
  fireEvent.click(all);
  expect(screen.getByRole('button', { name: 'Update Selected (100)' })).toBeEnabled();
  expect((all as HTMLInputElement).indeterminate).toBe(true);
  fireEvent.click(all);
  expect(screen.queryByRole('button', { name: /Update Selected/ })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select ticket 1' })).not.toBeChecked();
});

it('keeps J and K off the hidden queue during a search and drops the search at sign-out', async () => {
  vi.useFakeTimers();
  localStorage.clear();
  let signedIn = true;
  const invoke = queueApi([ticket], (command) => ({
    status: signedIn ? 'connected' : 'disconnected',
    ...(command.action === 'searchTickets'
      ? {
          ticketSearch: {
            query: 'printer',
            page: 0,
            hasMore: false,
            tickets: [{ ...ticket, id: '777', number: '820001', subject: 'Printer offline' }],
          },
        }
      : {}),
  }));
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  const flush = (ms = 0) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  render(<LiveSdpQueues />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'NOC' }));
  await flush();
  expect(screen.getByRole('button', { name: /Open ticket 810129:/ })).toBeEnabled();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search all SDP tickets' }), {
    target: { value: 'printer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search SDP' }));
  await flush();
  expect(screen.getByRole('region', { name: 'SDP search results' })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'j' });
  expect(document.activeElement).toBe(document.body);
  signedIn = false;
  await flush(5_000);
  signedIn = true;
  await flush(5_000);
  expect(screen.getByRole('button', { name: 'NOC' })).toBeEnabled();
  expect(screen.queryByRole('region', { name: 'SDP search results' })).not.toBeInTheDocument();
});
