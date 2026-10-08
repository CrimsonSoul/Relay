import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import type { SdpFormField } from '@shared/sdpForm';
import { SdpTicketOverview } from './SdpTicketOverview';
import { chooseSdpOption, sdpPicker } from './sdpPicker.test-util';
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
const choice = (id: string, name: string) => ({ label: name, value: { id, name } });
const field = (key: string, label: string, extra: Partial<SdpFormField>): SdpFormField => ({
  key,
  label,
  section: 'Details',
  kind: 'lookup',
  value: null,
  required: false,
  readOnly: false,
  multiple: false,
  maxLength: 250,
  dependencies: [],
  choices: [],
  ...extra,
});
const form = {
  id: '123',
  template: { id: '7', name: 'Example template' },
  canEdit: true,
  fields: [
    field('status', 'Status', {
      value: { id: '1', name: 'Open' },
      choices: [choice('1', 'Open'), choice('2', 'Closed')],
    }),
    field('priority', 'Priority', { value: { id: '3', name: 'Low' }, readOnly: true }),
    field('group', 'Support group', {
      value: { id: '5', name: 'NOC' },
      choices: [choice('5', 'NOC'), choice('6', 'SOX')],
    }),
    field('technician', 'Technician', {
      value: { id: '8', name: 'Example technician' },
      dependencies: ['group'],
      choices: [choice('8', 'Example technician')],
    }),
  ],
};
const confirmationId = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
function setup() {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readForm' ? { form } : {}),
      ...(command.action === 'prepareChange'
        ? { review: { confirmationId, expiresAt: Date.now() + 300000, mutation: command.mutation } }
        : {}),
      ...(command.action === 'confirmChange'
        ? {
            message: 'Change confirmed by SDP.',
            changeResult: { id: '123', number: '810129', kind: 'edit' },
          }
        : {}),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const onResult = vi.fn();
  const onBusy = vi.fn();
  render(<SdpTicketOverview ticket={ticket} enabled onBusy={onBusy} onResult={onResult} />);
  return { invoke, onResult, onBusy };
}

it('changes a status in place after an old-to-new review and one confirmation', async () => {
  const { invoke, onResult, onBusy } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Change status, currently Open' }));
  // The choices open straight away with their search focused, as clicking an SDP field does.
  const search = await screen.findByRole('combobox', { name: 'Search Status choices' });
  expect(invoke).toHaveBeenCalledWith({ action: 'readForm', id: '123' });
  await waitFor(() => expect(search).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: 'Closed' }));
  expect(sdpPicker('Status')).toHaveFocus();
  expect(screen.getByRole('list', { name: 'Change to confirm' })).toHaveTextContent(
    'Status: Open → Closed',
  );
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepareChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Saved to SDP.');
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'edit', id: '123', fields: { status: { id: '2', name: 'Closed' } } },
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'confirmChange', confirmationId });
  expect(onResult).toHaveBeenCalledWith(
    expect.objectContaining({ changeResult: expect.anything() }),
  );
  expect(onBusy).toHaveBeenCalledWith(true);
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  // The row has not been re-read (the ticket may have left a filtered page), so the confirmed
  // value stands in for it.
  expect(screen.getByRole('button', { name: 'Change status, currently Closed' })).toBeVisible();
});

it('clears a dependent technician, cancels with Escape and keeps read-only fields in the editor', async () => {
  const { invoke } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Change support group, currently NOC' }));
  await chooseSdpOption(await screen.findByRole('combobox', { name: 'Support group' }), 'SOX');
  const review = screen.getByRole('list', { name: 'Change to confirm' });
  expect(
    within(review)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(['Support group: NOC → SOX', 'Technician: Example technician → No technician']);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Save' }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('combobox', { name: 'Support group' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change priority, currently Low' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'SDP does not allow changing priority on this ticket.',
  );
  expect(screen.queryByRole('combobox', { name: 'Priority' })).not.toBeInTheDocument();
  expect(invoke.mock.calls.filter(([command]) => command.action === 'readForm')).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepareChange' }));
});

it('shows plain values without edit controls when the ticket is not live', () => {
  globalThis.api = { ...original, sdpAccount: vi.fn() } as BridgeAPI;
  render(<SdpTicketOverview ticket={ticket} enabled={false} onBusy={vi.fn()} onResult={vi.fn()} />);
  expect(screen.getByText('Open')).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Change / })).not.toBeInTheDocument();
});
