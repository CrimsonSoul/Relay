import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Activity } from 'react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpChangeDialog } from './SdpChangeDialog';
const original = globalThis.api;
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
  expect(invoke).not.toHaveBeenCalled();
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
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]?.[0]).toMatchObject({
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
  expect(invoke).toHaveBeenCalledTimes(2);
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
  expect(invoke).toHaveBeenCalledTimes(2);
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
it('closes a ticket as SDP does: a required resolution and the status fixed to Closed', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => ({
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
  render(<SdpChangeDialog mode="close" ticket={ticket} onClose={vi.fn()} onResult={vi.fn()} />);
  expect(screen.getByRole('dialog', { name: 'Close ticket' })).toBeVisible();
  expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the resolution to close this ticket.');
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Resolution'), {
    target: { value: 'Restarted the link' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  await screen.findByRole('button', { name: 'Save' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: {
      kind: 'update',
      id: '123',
      fields: { status: 'Closed', resolution: 'Restarted the link' },
    },
  });
  expect(screen.getByRole('region', { name: 'Review live change' })).toHaveTextContent(
    'StatusClosed',
  );
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
  fireEvent.change(screen.getByLabelText('Resolution'), { target: { value: 'Restarted' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(refusal));
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
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
      <SdpChangeDialog mode="note" ticket={ticket} onClose={vi.fn()} onResult={onResult} />
    </Activity>
  );
  const { rerender } = render(tab(true));
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Carrier engaged' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Change' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
  rerender(tab(false));
  await act(async () => {
    release();
    await held;
  });
  rerender(tab(true));
  expect(await screen.findByRole('button', { name: 'Done' })).toBeEnabled();
  expect(onResult).toHaveBeenCalledOnce();
});
