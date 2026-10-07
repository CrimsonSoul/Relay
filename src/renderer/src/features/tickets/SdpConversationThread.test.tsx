import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import type { SdpAccountView } from '@shared/sdpAccount';
import { SdpTicketWorkspace } from './SdpTicketWorkspace';
import type { SdpDetailSection } from './SdpTicketContent';
import { emailText, parseEmail, quotedNodes } from './sdpEmailThread';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const ticket = {
  id: '123',
  number: '810129',
  subject: 'Synthetic ticket',
  status: 'Open',
  priority: 'Low',
  group: 'NOC' as const,
  technician: 'Example technician',
  createdAt: 1000,
  dueAt: null,
};
const reply =
  '<div><p>Thanks, the circuit is back.</p><p>Example Requester<br>Network Operations</p>' +
  '<div style="border-top:solid 1pt"><p><b>From:</b> Example Technician<br><b>Sent:</b> Monday' +
  '<br><b>To:</b> Example Requester<br><b>Subject:</b> Circuit</p></div>' +
  '<p>Earlier text that should fold</p></div>';
const view: SdpAccountView = {
  configured: true,
  status: 'connected',
  detail: {
    id: '123',
    page: 0,
    hasMore: false,
    description: '<p>The circuit at the example site is down.</p>',
    properties: [{ label: 'Requester', value: 'Example Requester' }],
    conversations: [
      {
        id: '72',
        subject: 'RE: Circuit',
        body: reply,
        author: 'Example Requester',
        createdAt: 3000,
      },
      {
        id: '71',
        subject: 'Circuit',
        body: '<p>We are checking the circuit.</p>',
        author: 'Example Technician',
        createdAt: 2000,
      },
    ],
    notes: [{ id: '9', body: '<p>Carrier ticket opened</p>', author: 'Analyst', createdAt: 2500 }],
  },
  detailSnapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
  snapshot: { source: 'live', fetchedAt: Date.now(), expiresAt: Date.now() + 60000 },
};

function Harness() {
  const [editor, setEditor] = useState<'edit' | 'reply' | 'forward'>();
  const [section, setSection] = useState<SdpDetailSection>('Conversations');
  return (
    <SdpTicketWorkspace
      ticket={ticket}
      view={view}
      groups={[]}
      busy={false}
      editor={editor}
      section={section}
      onSection={setSection}
      onEditor={setEditor}
      onAction={vi.fn()}
      onResult={vi.fn()}
      onOverviewBusy={vi.fn()}
      onRefresh={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

function setup() {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readReplyContext'
        ? {
            replyContext: {
              id: '123',
              subject: 'Re: [Request ID :##810129##] : Synthetic ticket',
              to: ['requester@example.test'],
              cc: ['watcher@example.test'],
              canReply: true,
            },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<Harness />);
  return invoke;
}

it('folds the earlier mail a reply quotes only when the reply adds something', () => {
  expect(quotedNodes(parseEmail(reply))?.size).toBe(2);
  expect(emailText(reply)).toBe(
    'Thanks, the circuit is back.\nExample Requester\nNetwork Operations',
  );
  const forwarded = '<div><b>From:</b> Someone<br><b>Sent:</b> Monday</div><p>Body</p>';
  expect(quotedNodes(parseEmail(forwarded))).toBeUndefined();
  expect(quotedNodes(parseEmail('<p>Hi</p><div class="gmail_quote">On Monday…</div>'))?.size).toBe(
    1,
  );
});

it('shows notes at the top, then the request and emails in time order with folded quotes', () => {
  setup();
  const thread = screen.getByRole('list');
  const cards = within(thread).getAllByRole('article');
  expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
    expect.stringMatching(/^Note from Analyst/),
    'Original request from Example Requester',
    expect.stringMatching(
      /^Email from Example Technician, \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M \S+$/,
    ),
    expect.stringMatching(/^Email from Example Requester/),
  ]);
  expect(screen.getByText('The circuit at the example site is down.')).not.toBeVisible();
  expect(screen.queryByText('Earlier text that should fold')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show Quoted Text' }));
  expect(screen.getByText('Earlier text that should fold')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sort order: oldest first' }));
  expect(
    within(thread)
      .getAllByRole('article')
      .slice(0, 2)
      .map((card) => card.getAttribute('aria-label')),
  ).toEqual([
    expect.stringMatching(/^Note from Analyst/),
    expect.stringMatching(/^Email from Example Requester/),
  ]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Notes' }));
  expect(screen.queryByText('Carrier ticket opened')).not.toBeInTheDocument();
});

it('opens a reply beneath the message it answers and keeps it while sections change', async () => {
  const invoke = setup();
  fireEvent.click(screen.getByRole('button', { name: /^Reply to email from Example Technician/ }));
  const draft = await screen.findByRole('region', { name: 'Reply to ticket' });
  const card = screen.getByRole('article', { name: /^Email from Example Technician/ });
  expect(card.parentElement?.contains(draft)).toBe(true);
  await waitFor(() =>
    expect(within(draft).getByLabelText('To')).toHaveValue('requester@example.test'),
  );
  expect(within(draft).getByLabelText('Cc')).toHaveValue('');
  const message = within(draft).getByLabelText('Message') as HTMLTextAreaElement;
  expect(message.value).toContain('From: Example Technician');
  expect(message.value).toContain('We are checking the circuit.');
  fireEvent.change(message, { target: { value: `Working on it.${message.value}` } });
  expect(screen.queryByRole('button', { name: /^Reply all to/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
  expect(
    (
      within(screen.getByRole('region', { name: 'Reply to ticket' })).getByLabelText(
        'Message',
      ) as HTMLTextAreaElement
    ).value,
  ).toMatch(/^Working on it\./);
  expect(
    invoke.mock.calls.filter(([command]) => command.action === 'readReplyContext'),
  ).toHaveLength(1);
});

it('keeps the ticket CC list for Reply All', async () => {
  setup();
  fireEvent.click(
    screen.getByRole('button', { name: /^Reply all to email from Example Requester/ }),
  );
  const draft = await screen.findByRole('region', { name: 'Reply to ticket' });
  await waitFor(() =>
    expect(within(draft).getByLabelText('Cc')).toHaveValue('watcher@example.test'),
  );
});

it('returns focus to the header action when a draft closes', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  const draft = await screen.findByRole('region', { name: 'Reply to ticket' });
  await waitFor(() =>
    expect(within(draft).getByLabelText('To')).toHaveValue('requester@example.test'),
  );
  fireEvent.click(within(draft).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reply' })).toHaveFocus());
});
