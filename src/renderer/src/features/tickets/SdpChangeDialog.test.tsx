import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Activity } from 'react';
import type { BridgeAPI } from '@shared/ipc';
import { sdpRejectionMessage } from '@shared/sdpMutation';
import { SdpChangeDialog } from './SdpChangeDialog';
import { chooseSdpOption } from './sdpPicker.test-util';
const original = globalThis.api;
/** The commands that prepare or send a change, past the form's default-ID and form reads. */
const sent = (invoke: ReturnType<typeof vi.fn>) =>
  invoke.mock.calls
    .map(([command]) => command)
    .filter((command) => !['readStandardOptions', 'readForm'].includes(command.action));
/** Close Ticket waits for the check of the fields SDP requires to close. */
const closeReady = () =>
  waitFor(() => expect(screen.getByRole('button', { name: 'Close Ticket' })).toBeEnabled());
afterEach(() => {
  globalThis.api = original;
});
it('requires the default template requester before reviewing a major incident', () => {
  const invoke = vi.fn();
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpChangeDialog mode="major" onClose={vi.fn()} onResult={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Test incident' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a requester email');
  expect(sent(invoke)).toEqual([]);
});
it('reviews a real create before sending its one-use confirmation, then prevents resubmission', async () => {
  const id = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'prepareChange'
        ? {
            review: {
              confirmationId: id,
              expiresAt: Date.now() + 300000,
              mutation: command.mutation,
            },
          }
        : {
            changeResult: { id: '123', number: '789', kind: 'create' },
            message: 'Change confirmed by SDP.',
          }),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const result = vi.fn();
  render(<SdpChangeDialog mode="major" onClose={vi.fn()} onResult={result} />);
  fireEvent.change(screen.getByLabelText('Subject'), {
    target: { value: 'Synthetic major incident' },
  });
  fireEvent.change(screen.getByLabelText('Requester email'), {
    target: { value: 'test@example.test' },
  });
  expect(screen.getByText(/marked Major incident in SDP/)).toBeInTheDocument();
  for (const name of ['Subject', 'Requester email', 'Request type', 'Impact', 'Urgency'])
    expect(
      screen.getByRole(name === 'Subject' || name === 'Requester email' ? 'textbox' : 'combobox', {
        name,
      }),
    ).toHaveAttribute('aria-required', 'true');
  expect(screen.queryByLabelText('Template ID')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  const confirm = await screen.findByRole('button', { name: 'Save' });
  expect(sent(invoke)).toHaveLength(1);
  expect(sent(invoke)[0]).toMatchObject({
    action: 'prepareChange',
    mutation: {
      majorIncident: true,
      templateId: '142866000146669084',
      requesterEmail: 'test@example.test',
      fields: {
        subject: 'Synthetic major incident',
        requestType: 'Incident',
        impact: 'Single User',
        urgency: 'Medium',
      },
    },
  });
  expect(screen.getByText(/Major incident: Yes/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Review live change' })).toHaveTextContent(
    'Synthetic major incident',
  );
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(result).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenLastCalledWith({ action: 'confirmChange', confirmationId: id });
  expect(sent(invoke)).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});
it('does not claim success or offer an automatic retry after a lost write response', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'confirmChange') throw new Error('Connection lost');
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        review: {
          confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
          expiresAt: Date.now() + 300000,
          mutation: command.mutation,
        },
      },
    };
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const result = vi.fn();
  render(<SdpChangeDialog mode="create" onClose={vi.fn()} onResult={result} />);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
  // An uncertain result is an error, never a quiet status line.
  expect(await screen.findByRole('alert')).toHaveTextContent('uncertain');
  expect(result).not.toHaveBeenCalled();
  expect(sent(invoke)).toHaveLength(2);
});
it('locks multiline fields with the rest of the form while a change is being prepared', async () => {
  const invoke = vi
    .fn()
    .mockImplementation((command) =>
      command.action === 'prepareChange'
        ? new Promise(() => undefined)
        : Promise.resolve({ success: false }),
    );
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpChangeDialog mode="create" onClose={vi.fn()} onResult={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  await waitFor(() => expect(screen.getByLabelText('Subject')).toBeDisabled());
  expect(screen.getByLabelText('Description')).toBeDisabled();
});
it('closes a ticket in one step: a required resolution and the status fixed to Closed', async () => {
  const id = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data:
      command.action === 'prepareChange'
        ? {
            configured: true,
            status: 'connected',
            review: {
              confirmationId: id,
              expiresAt: Date.now() + 300000,
              mutation: command.mutation,
            },
          }
        : {
            configured: true,
            status: 'connected',
            changeResult: { kind: 'update', id: '123', number: '810129' },
          },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  const onClose = vi.fn();
  const onResult = vi.fn();
  render(<SdpChangeDialog mode="close" ticket={ticket} onClose={onClose} onResult={onResult} />);
  expect(screen.getByRole('dialog', { name: 'Close ticket' })).toBeVisible();
  expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review Change' })).not.toBeInTheDocument();
  await closeReady();
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the resolution to close this ticket.');
  expect(sent(invoke)).toEqual([]);
  fireEvent.change(screen.getByLabelText('Resolution'), {
    target: { value: 'Restarted the link' },
  });
  // Ctrl/Cmd+Enter in the resolution sends it as the button does.
  fireEvent.keyDown(screen.getByLabelText('Resolution'), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(sent(invoke)).toEqual([
    {
      action: 'prepareChange',
      mutation: {
        kind: 'update',
        id: '123',
        fields: { status: 'Closed', resolution: 'Restarted the link' },
      },
    },
    { action: 'confirmChange', confirmationId: id },
  ]);
  expect(onResult).toHaveBeenCalledOnce();
});
it('shows SDP’s missing required fields when a close cannot be prepared', async () => {
  const refusal =
    'Ticket #810129 cannot be closed yet: SDP requires Category. Open the ticket, fill in the missing fields, then close it.';
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: { configured: true, status: 'connected', message: refusal },
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  render(<SdpChangeDialog mode="close" ticket={ticket} onClose={vi.fn()} onResult={vi.fn()} />);
  await closeReady();
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Restarted' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(refusal));
  expect(sent(invoke)).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Close Ticket' })).toBeEnabled();
});
it('groups a new ticket into sections and keeps the template ID in a fold', () => {
  globalThis.api = { ...original, sdpAccount: vi.fn() } as BridgeAPI;
  render(<SdpChangeDialog mode="create" onClose={vi.fn()} onResult={vi.fn()} />);
  expect(
    screen
      .getAllByRole('group')
      .filter((group) => group.tagName === 'FIELDSET')
      .map((group) => group.querySelector('legend')?.textContent),
  ).toEqual(['Request', 'Requester', 'Assignment', 'Status and priority']);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveAttribute('aria-required', 'true');
  expect(screen.getByRole('textbox', { name: 'Requester email' })).not.toHaveAttribute(
    'aria-required',
  );
  expect(screen.getByText('SDP template').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByLabelText('Template ID')).toBeInTheDocument();
});

it('finishes a change confirmed while Tickets is hidden', async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command.action === 'confirmChange') await held;
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        message: 'Note added.',
        changeResult: { kind: 'update', id: '123', number: '810129' },
        review: {
          confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
          expiresAt: Date.now() + 300000,
          mutation: command.mutation,
        },
      },
    };
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const onResult = vi.fn();
  const onClose = vi.fn();
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  // App keeps Tickets mounted in an Activity while another tab shows.
  const tab = (visible: boolean) => (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <SdpChangeDialog mode="note" ticket={ticket} onClose={onClose} onResult={onResult} />
    </Activity>
  );
  const { rerender } = render(tab(true));
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Carrier engaged' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Note' }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ action: 'confirmChange' })),
  );
  rerender(tab(false));
  await act(async () => {
    release();
    await held;
  });
  rerender(tab(true));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onResult).toHaveBeenCalledOnce();
});

it('closes with SDP’s ID for Closed, looked up as the dialog opens', async () => {
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
              choices: [
                { label: 'Closed Pending', value: { id: '3', name: 'Closed Pending' } },
                { label: 'Closed', value: { id: '4', name: 'Closed' } },
              ],
            },
          }
        : {}),
      ...(command.action === 'prepareChange'
        ? {
            review: {
              confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
              expiresAt: Date.now() + 300000,
              mutation: command.mutation,
            },
          }
        : { changeResult: { kind: 'update', id: '123', number: '810129' } }),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  const onClose = vi.fn();
  render(<SdpChangeDialog mode="close" ticket={ticket} onClose={onClose} onResult={vi.fn()} />);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'readStandardOptions', field: 'status', search: 'Closed' }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Restarted' } });
  await act(async () => {});
  await closeReady();
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(sent(invoke)[0]).toEqual({
    action: 'prepareChange',
    mutation: {
      kind: 'update',
      id: '123',
      fields: { status: 'Closed', resolution: 'Restarted' },
      fieldIds: { status: '4' },
    },
  });
});

it('asks for the fields SDP requires to close and saves them before closing', async () => {
  const confirmationId = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
  const required = { required: true, readOnly: false, multiple: false, dependencies: [] };
  const category = {
    ...required,
    key: 'category',
    label: 'Category',
    section: 'Details',
    kind: 'lookup' as const,
    value: null,
    choices: [{ label: 'Network', value: { id: '9', name: 'Network' } }],
  };
  const form = {
    id: '123',
    template: { id: '7', name: 'Incident' },
    canEdit: true,
    fields: [
      category,
      { ...category, key: 'priority', label: 'Priority', value: { id: '2', name: 'Low' } },
      { ...category, key: 'status', label: 'Status', value: { id: '1', name: 'Open' } },
    ],
  };
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(command.action === 'readForm' ? { form } : {}),
      ...(command.action === 'readOptions'
        ? { options: { field: 'category', hasMore: false, choices: category.choices } }
        : {}),
      ...(command.action === 'prepareChange'
        ? { review: { confirmationId, expiresAt: Date.now() + 300000, mutation: command.mutation } }
        : { changeResult: { kind: 'update', id: '123', number: '810129' } }),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  const onClose = vi.fn();
  const onResult = vi.fn();
  render(
    <SdpChangeDialog
      mode="close"
      ticket={ticket}
      closeStatus="Resolved"
      onClose={onClose}
      onResult={onResult}
    />,
  );
  const group = await screen.findByRole('group', { name: 'Required by SDP to close' });
  // Only the required field the ticket leaves empty is asked for; the status is the close's own.
  expect(within(group).getByText('Category *')).toBeInTheDocument();
  expect(within(group).queryByText(/Priority|Status/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Replaced cable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Mark Resolved Ticket' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Fill in Category to close this ticket. SDP requires it.',
  );
  expect(sent(invoke)).toEqual([]);
  await chooseSdpOption(within(group).getByRole('combobox'), 'Network');
  fireEvent.click(screen.getByRole('button', { name: 'Mark Resolved Ticket' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(sent(invoke).filter((c) => c.action !== 'readOptions')).toEqual([
    {
      action: 'prepareChange',
      mutation: { kind: 'edit', id: '123', fields: { category: { id: '9', name: 'Network' } } },
    },
    { action: 'confirmChange', confirmationId },
    {
      action: 'prepareChange',
      mutation: {
        kind: 'update',
        id: '123',
        fields: { status: 'Resolved', resolution: 'Replaced cable' },
      },
    },
    { action: 'confirmChange', confirmationId },
  ]);
  expect(onResult).toHaveBeenCalledTimes(2);
});

it('asks for the fields SDP’s closing rules name when SDP rejects the close, then closes', async () => {
  const confirmationId = 'f6d1a214-87d9-45ef-9bce-b1a850e5d301';
  const category = {
    key: 'category',
    label: 'Category',
    section: 'Details',
    kind: 'lookup' as const,
    value: null,
    required: false,
    readOnly: false,
    multiple: false,
    dependencies: [],
    choices: [{ label: 'Network', value: { id: '9', name: 'Network' } }],
  };
  const form = {
    id: '123',
    template: { id: '7', name: 'Incident' },
    canEdit: true,
    fields: [category],
  };
  let closes = 0;
  const invoke = vi.fn().mockImplementation(async (command) => {
    const base = { configured: true, status: 'connected' };
    if (command.action === 'readForm') return { success: true, data: { ...base, form } };
    if (command.action === 'readOptions')
      return {
        success: true,
        data: {
          ...base,
          options: { field: 'category', hasMore: false, choices: category.choices },
        },
      };
    if (command.action === 'prepareChange')
      return {
        success: true,
        data: {
          ...base,
          review: { confirmationId, expiresAt: Date.now() + 300000, mutation: command.mutation },
        },
      };
    const update = invoke.mock.calls.findLast(([c]) => c.action === 'prepareChange')?.[0].mutation
      .kind;
    if (update === 'update' && closes++ === 0)
      return {
        success: true,
        data: { ...base, message: sdpRejectionMessage(['category', 'closure_info.closure_code']) },
      };
    return {
      success: true,
      data: { ...base, changeResult: { kind: update, id: '123', number: '810129' } },
    };
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  const onClose = vi.fn();
  render(<SdpChangeDialog mode="close" ticket={ticket} onClose={onClose} onResult={vi.fn()} />);
  await closeReady();
  // The template requires nothing more, so nothing is asked before SDP is.
  expect(screen.queryByRole('group', { name: 'Required by SDP to close' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Replaced cable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  const group = await screen.findByRole('group', { name: 'Required by SDP to close' });
  expect(screen.getByRole('alert')).toHaveTextContent('SDP requires more fields to close');
  expect(within(group).getByText('Category')).toBeInTheDocument();
  expect(group).toHaveTextContent('SDP also requires Closure code');
  // A rejection applied nothing, so the close can be sent again.
  expect(screen.getByRole('button', { name: 'Close Ticket' })).toBeEnabled();
  await chooseSdpOption(within(group).getByRole('combobox'), 'Network');
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(
    sent(invoke)
      .filter((c) => c.action === 'prepareChange')
      .map((c) => c.mutation.kind),
  ).toEqual(['update', 'edit', 'update']);
});

it('shows SDP’s own reason when it rejects a close again for fields already asked for', async () => {
  const rejection = sdpRejectionMessage(['closure_info.closure_code']);
  const invoke = vi.fn().mockImplementation(async (command) => {
    const base = { configured: true, status: 'connected' };
    if (command.action === 'prepareChange')
      return {
        success: true,
        data: {
          ...base,
          review: {
            confirmationId: 'f6d1a214-87d9-45ef-9bce-b1a850e5d301',
            expiresAt: Date.now() + 300000,
            mutation: command.mutation,
          },
        },
      };
    if (command.action === 'confirmChange')
      return { success: true, data: { ...base, message: rejection } };
    return {
      success: true,
      data: {
        ...base,
        form: { id: '123', template: { id: '7', name: 'Incident' }, canEdit: true, fields: [] },
      },
    };
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const ticket = {
    id: '123',
    number: '810129',
    subject: 'Synthetic',
    status: 'Open',
    priority: 'Low',
    group: 'NOC' as const,
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  render(<SdpChangeDialog mode="close" ticket={ticket} onClose={vi.fn()} onResult={vi.fn()} />);
  await closeReady();
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Replaced cable' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  await screen.findByText(/SDP also requires Closure code/);
  fireEvent.click(screen.getByRole('button', { name: 'Close Ticket' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(rejection));
  expect(screen.queryByRole('button', { name: 'Close Ticket' })).not.toBeInTheDocument();
});
