import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { SdpBody, SdpTicketContent } from './SdpTicketContent';
import { LiveSdpQueues } from './LiveSdpQueues';
import type { ReactNode } from 'react';
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
  fireEvent.click(screen.getByText('Original request', { selector: 'summary' }));
  expect(screen.getByText('Example description')).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show automatic notifications' }));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Show automatic notifications' })).toBeChecked(),
  );
  expect(invoke).toHaveBeenCalledWith({
    action: 'readDetail',
    id: '123',
    page: 0,
    includeAutoNotifications: true,
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show automatic notifications' }));
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Show automatic notifications' }),
    ).not.toBeChecked(),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
  expect(screen.getByText('Single user')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
  expect(screen.getByText('Example internal note')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Forward Message' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
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
  expect(screen.getByText(/^Not updated since .* · Retrying$/)).toBeVisible();
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
  expect(screen.getByText('Live from SDP')).toBeVisible();
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
  fireEvent.click(first);
  await screen.findByRole('complementary', { name: 'Ticket 810129' });
  await waitFor(() => expect(first).toBeEnabled());
  fireEvent.keyDown(document.body, { key: 'j' });
  await screen.findByRole('complementary', { name: 'Ticket 810130' });
  expect(invoke).toHaveBeenLastCalledWith({ action: 'readDetail', id: '124', page: 0 });
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
  view.rerender(<SdpTicketContent {...props} section="Notes" />);
  fireEvent.click(screen.getByRole('button', { name: 'Older Activity' }));
  expect(onPage).toHaveBeenLastCalledWith(1);
  view.rerender(
    <SdpTicketContent {...props} section="Conversations" detail={{ ...detail, page: 1 }} />,
  );
  expect(screen.getByRole('button', { name: 'Older Activity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Newer Activity' }));
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

it('groups ticket navigation into six sections without losing detail views', () => {
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
  expect(within(navigation).getAllByRole('tab')).toHaveLength(6);
  expect(within(navigation).queryByRole('tab', { name: 'Messages' })).toBeNull();
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
