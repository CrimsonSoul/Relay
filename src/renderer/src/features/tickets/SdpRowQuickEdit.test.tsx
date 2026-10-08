import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SDP_BULK_OUTCOME_MESSAGE } from '@shared/sdpMutation';
import { SdpRowQuickEdit, type SdpRowField } from './SdpRowQuickEdit';
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
  group: 'NOC',
  technician: 'Example technician',
  createdAt: 1000,
  dueAt: null,
};
const confirmationId = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
const options: Record<string, { id: string; name: string }[]> = {
  status: [
    { id: '1', name: 'Open' },
    { id: '2', name: 'Closed' },
  ],
  group: [{ id: '5', name: 'NOC' }],
  technician: [{ id: '8', name: 'Second technician' }],
};
function setup(field: SdpRowField, editable = true) {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readStandardOptions'
        ? {
            options: {
              field: command.field,
              choices: options[command.field]!.map((value) => ({ label: value.name, value })),
              hasMore: false,
            },
          }
        : {}),
      ...(command.action === 'prepareChange'
        ? { review: { confirmationId, expiresAt: Date.now() + 300000, mutation: command.mutation } }
        : {}),
      ...(command.action === 'confirmChange'
        ? { message: SDP_BULK_OUTCOME_MESSAGE, bulkResult: [{ id: '123', status: 'confirmed' }] }
        : {}),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const onResult = vi.fn();
  const onBusy = vi.fn();
  render(
    <SdpRowQuickEdit
      ticket={ticket}
      field={field}
      editable={editable}
      onBusy={onBusy}
      onResult={onResult}
    />,
  );
  return { invoke, onResult, onBusy };
}

it('changes one ticket’s status from its row after an old-to-new review and one confirmation', async () => {
  const { invoke, onResult, onBusy } = setup('status');
  const trigger = screen.getByRole('button', {
    name: 'Change status for ticket 810129, currently Open',
  });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Change status for ticket #810129' });
  // One press lands in the choices' search; the current value is marked.
  const search = await screen.findByRole('combobox', { name: 'Search Status choices' });
  await waitFor(() => expect(search).toHaveFocus());
  await screen.findByRole('option', { name: 'Open', selected: true });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('option', { name: 'Closed' }));
  expect(screen.getByRole('option', { name: 'Closed', selected: true })).toBeVisible();
  expect(dialog).toHaveTextContent('Status: Open → Closed');
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepareChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'bulk', ids: ['123'], fields: { status: 'Closed' } },
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'confirmChange', confirmationId });
  // The queue message names the ticket rather than describing a bulk run.
  expect(onResult.mock.calls[0]![0].message).toBe('Ticket #810129: status changed to Closed.');
  expect(onBusy).toHaveBeenCalledWith(true);
  expect(onBusy).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('lists the ticket group’s technicians and unassigns as a cleared value', async () => {
  const { invoke } = setup('technician');
  fireEvent.click(screen.getByRole('button', { name: /^Change technician for ticket 810129/ }));
  await screen.findByRole('option', { name: 'Second technician' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'readStandardOptions',
    field: 'group',
    search: 'NOC',
    page: 0,
  });
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'readStandardOptions', field: 'technician', groupId: '5' }),
  );
  fireEvent.click(screen.getByRole('option', { name: 'Unassigned' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Technician: Example technician → No technician',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'prepareChange',
      mutation: { kind: 'bulk', ids: ['123'], fields: { technician: null } },
    }),
  );
});

it('cancels with Escape without sending anything and keeps a locked row as text', async () => {
  const { invoke } = setup('group');
  const trigger = screen.getByRole('button', {
    name: 'Change group for ticket 810129, currently NOC',
  });
  fireEvent.click(trigger);
  const group = await screen.findByRole('combobox', { name: 'Search Group choices' });
  const shortcut = vi.fn();
  globalThis.addEventListener('keydown', shortcut);
  fireEvent.keyDown(group, { key: 'Escape' });
  globalThis.removeEventListener('keydown', shortcut);
  // The open ticket's Escape shortcut never sees the key.
  expect(shortcut).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  // Moving focus out of the panel closes it too, leaving focus where it went.
  fireEvent.click(trigger);
  const reopened = await screen.findByRole('combobox', { name: 'Search Group choices' });
  const elsewhere = document.createElement('button');
  document.body.append(elsewhere);
  fireEvent.blur(reopened, { relatedTarget: elsewhere });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  elsewhere.remove();
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepareChange' }));
});

it('shows plain values without change controls when the row is locked', () => {
  setup('status', false);
  expect(screen.getByText('Open')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
