import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';
import { SdpTicketContent } from './SdpTicketContent';
import { LiveSdpQueues, SdpBody } from './LiveSdpQueues';
vi.mock('../../services/pocketbase', () => ({ getPb: () => ({ baseURL: 'http://relay.test' }) }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(screen.getByText('Single user')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  expect(screen.getByText('Example internal note')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
  expect(screen.getByText('Example reply')).toBeVisible();
  expect(invoke).toHaveBeenCalledWith({ action: 'readDetail', id: '123', page: 0 });
  const more = screen.getByRole('button', { name: 'More actions' });
  more.focus();
  fireEvent.click(more);
  expect(screen.getByRole('menuitem', { name: 'Refresh ticket' })).toBeVisible();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(more).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Back to queue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({ action: 'readQueue', queue: 'NOC', page: 1 }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Clear my saved SDP data' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear my saved SDP data' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /Synthetic live subject/ }),
    ).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith({ action: 'clearCopies' });
  expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled();
});
it('removes live rows when a refresh cannot reach Relay', async () => {
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      queuePage: { queue: 'NOC', page: 0, hasMore: false, tickets: [ticket] },
    },
  });
  globalThis.api = { ...original, runtime: ELECTRON_RUNTIME, sdpAccount: invoke } as BridgeAPI;
  render(<LiveSdpQueues />);
  await screen.findByRole('button', { name: /Synthetic live subject/ });
  invoke.mockResolvedValue({ success: false, error: 'offline' });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /Synthetic live subject/ })).not.toBeInTheDocument();
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
  await waitFor(() => expect(screen.getByRole('button', { name: 'New ticket' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Synthetic workspace' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Clear my saved SDP data' })).not.toBeInTheDocument();
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
  expect(screen.queryByRole('button', { name: 'Next activity' })).not.toBeInTheDocument();
  view.rerender(<SdpTicketContent {...props} section="Notes" />);
  fireEvent.click(screen.getByRole('button', { name: 'Next activity' }));
  expect(onPage).toHaveBeenLastCalledWith(1);
  view.rerender(
    <SdpTicketContent {...props} section="Conversations" detail={{ ...detail, page: 1 }} />,
  );
  expect(screen.getByRole('button', { name: 'Next activity' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous activity' }));
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
