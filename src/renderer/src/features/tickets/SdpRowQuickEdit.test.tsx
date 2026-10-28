import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SDP_SERVER_UPDATE_MESSAGE } from '@shared/sdpAccount';
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
  group: [
    { id: '5', name: 'NOC' },
    { id: '6', name: 'Service Desk' },
  ],
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
        ? {
            message: SDP_BULK_OUTCOME_MESSAGE,
            bulkResult: [{ id: '123', status: 'confirmed' }],
            changeResult: { kind: 'edit', id: '123', number: '810129' },
          }
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

it('changes one ticket’s status from its row as soon as a value is chosen', async () => {
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
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  // Choosing the current value sends nothing.
  fireEvent.click(screen.getByRole('option', { name: 'Open' }));
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepareChange' }));
  fireEvent.click(screen.getByRole('option', { name: 'Closed' }));
  expect(dialog).toHaveTextContent('Saving… Status: Open → Closed');
  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: {
      kind: 'bulk',
      ids: ['123'],
      fields: { status: 'Closed' },
      fieldIds: { status: '2' },
    },
  });
  expect(invoke).toHaveBeenCalledWith({ action: 'confirmChange', confirmationId });
  // The queue message names the ticket rather than describing a bulk run.
  expect(onResult.mock.calls[0]![0].message).toBe('Ticket #810129: status changed to Closed.');
  expect(onBusy).toHaveBeenCalledWith(true);
  // onResult runs before React commits the closing render; the queue hold releases on that commit.
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('shows SDP’s reason when a close is refused or rejected instead of a generic failure', async () => {
  const { invoke, onResult } = setup('status');
  const base = invoke.getMockImplementation()!;
  const refusal =
    'Ticket #810129 cannot be closed yet: SDP requires Resolution. Open the ticket, fill in the missing fields, then close it.';
  invoke.mockImplementation(async (command) =>
    command.action === 'prepareChange'
      ? { success: true, data: { configured: true, status: 'connected', message: refusal } }
      : base(command),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Change status for ticket 810129, currently Open' }),
  );
  fireEvent.click(await screen.findByRole('option', { name: 'Closed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'confirmChange' }));
  expect(onResult).not.toHaveBeenCalled();
  // SDP's own rejection of the write reaches the queue with its field list intact.
  const rejection =
    'SDP rejected the change. Check these fields: resolution. Refresh the ticket before preparing a new change.';
  invoke.mockImplementation(async (command) =>
    command.action === 'confirmChange'
      ? {
          success: true,
          data: {
            configured: true,
            status: 'connected',
            message: rejection,
            bulkResult: [{ id: '123', status: 'not-attempted' }],
          },
        }
      : base(command),
  );
  // Choosing the value again retries it.
  fireEvent.click(screen.getByRole('option', { name: 'Closed' }));
  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(onResult.mock.calls[0]![0].message).toBe(rejection);
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
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith({
      action: 'prepareChange',
      mutation: { kind: 'bulk', ids: ['123'], fields: { technician: null } },
    }),
  );
});

it('assigns a technician by SDP ID, as the editor does', async () => {
  const { invoke, onResult } = setup('technician');
  fireEvent.click(screen.getByRole('button', { name: /^Change technician for ticket 810129/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Second technician' }));
  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: {
      kind: 'bulk',
      ids: ['123'],
      fields: { technician: 'Second technician' },
      fieldIds: { technician: '8' },
    },
  });
  expect(onResult.mock.calls[0]![0].message).toBe(
    'Ticket #810129: technician changed to Second technician.',
  );
});

it('moves a ticket to another group by SDP ID and changes nothing else', async () => {
  const { invoke, onResult } = setup('group');
  fireEvent.click(screen.getByRole('button', { name: /^Change group for ticket 810129/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Service Desk' }));
  await waitFor(() => expect(onResult).toHaveBeenCalled());
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: {
      kind: 'bulk',
      ids: ['123'],
      fields: { group: 'Service Desk' },
      fieldIds: { group: '6' },
    },
  });
});

it('prepares by name again when the Relay server predates SDP IDs', async () => {
  const { invoke, onResult } = setup('group');
  const base = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (command) =>
    command.action === 'prepareChange' && command.mutation.fieldIds
      ? { success: false, error: SDP_SERVER_UPDATE_MESSAGE }
      : base(command),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Change group for ticket 810129/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Service Desk' }));
  await waitFor(() => expect(onResult).toHaveBeenCalled());
  const prepares = invoke.mock.calls
    .map(([command]) => command)
    .filter((command) => command.action === 'prepareChange');
  expect(prepares.map((command) => command.mutation)).toEqual([
    { kind: 'bulk', ids: ['123'], fields: { group: 'Service Desk' }, fieldIds: { group: '6' } },
    { kind: 'bulk', ids: ['123'], fields: { group: 'Service Desk' } },
  ]);
  expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ action: 'confirmChange' }));
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
