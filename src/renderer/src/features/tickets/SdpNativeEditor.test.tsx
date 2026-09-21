import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpNativeEditor } from './SdpNativeEditor';
import type { SdpFormField } from '@shared/sdpForm';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const ticket = {
  id: '123',
  number: '7',
  subject: 'Example ticket',
  status: 'Open',
  priority: 'Low',
  group: 'NOC' as const,
  technician: 'Example',
  createdAt: 1,
  dueAt: null,
};
const field = (
  key: string,
  kind: SdpFormField['kind'],
  value: SdpFormField['value'],
  extra: Partial<SdpFormField> = {},
): SdpFormField => ({
  key,
  label: key,
  section: 'Details',
  kind,
  value,
  required: false,
  readOnly: false,
  multiple: false,
  maxLength: 1000,
  dependencies: [],
  choices: [],
  ...extra,
});
const fields = [
  field('subject', 'text', 'Example ticket'),
  field('description', 'multiline', '<p>Formatted description</p>'),
  field(
    'status',
    'lookup',
    { id: '1', name: 'Open' },
    {
      choices: [
        { label: 'Open', value: { id: '1', name: 'Open' } },
        { label: 'Closed', value: { id: '2', name: 'Closed' } },
      ],
    },
  ),
  field(
    'group',
    'lookup',
    { id: '3', name: 'NOC' },
    {
      choices: [
        { label: 'NOC', value: { id: '3', name: 'NOC' } },
        { label: 'SOX', value: { id: '4', name: 'SOX' } },
      ],
    },
  ),
  field('technician', 'lookup', { id: '5', name: 'Example' }, { dependencies: ['group'] }),
];
function setup(mode: 'edit' | 'reply' = 'edit', formFields = fields) {
  const invoke = vi.fn().mockImplementation(async (c) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(c.action === 'readForm'
        ? {
            form: {
              id: '123',
              template: { id: '7', name: 'Incident' },
              canEdit: true,
              fields: formFields,
            },
          }
        : {}),
      ...(c.action === 'readReplyContext'
        ? {
            replyContext: {
              id: '123',
              to: ['requester@example.test'],
              cc: [],
              subject: 'Re: Example ticket',
              canReply: true,
            },
          }
        : {}),
      ...(c.action === 'prepareChange'
        ? {
            review: {
              confirmationId: '00000000-0000-4000-8000-000000000001',
              expiresAt: Date.now() + 60000,
              mutation: c.mutation,
            },
          }
        : {}),
      ...(c.action === 'confirmChange' ? { message: 'Confirmed' } : {}),
    },
  }));
  globalThis.api = { sdpAccount: invoke } as unknown as BridgeAPI;
  const close = vi.fn();
  render(<SdpNativeEditor ticket={ticket} mode={mode} onClose={close} onResult={vi.fn()} />);
  return { invoke, close };
}
it('keeps a failed editor open with the server explanation and a working Cancel action', async () => {
  const onClose = vi.fn();
  const onResult = vi.fn();
  const invoke = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      message:
        'SDP did not authorize this editor request. Your account is still connected. Cancel to return to the ticket.',
    },
  });
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpNativeEditor ticket={ticket} mode="edit" onClose={onClose} onResult={onResult} />);
  await screen.findByText(/Your account is still connected/);
  expect(onResult).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalled();
});
it('submits only dirty template fields and requires a distinct confirmation', async () => {
  const { invoke } = setup();
  await screen.findByLabelText('subject');
  fireEvent.change(screen.getByLabelText('status'), { target: { value: '2' } });
  fireEvent.click(screen.getByText('Review changes'));
  await screen.findByRole('region', { name: 'Review SDP change' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'edit', id: '123', fields: { status: { id: '2', name: 'Closed' } } },
  });
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
  fireEvent.click(screen.getByText('Confirm live change'));
  await screen.findByText('Confirmed');
});
it('clears dependent technician when group changes and guards unsaved drafts', async () => {
  const { invoke, close } = setup();
  await screen.findByLabelText('group');
  fireEvent.change(screen.getByLabelText('group'), { target: { value: '4' } });
  expect(screen.getByLabelText('technician')).toHaveValue('');
  fireEvent.click(screen.getByText('Review changes'));
  await screen.findByRole('region', { name: 'Review SDP change' });
  expect(
    invoke.mock.calls.find(([c]) => c.action === 'prepareChange')?.[0].mutation.fields,
  ).toEqual({ group: { id: '4', name: 'SOX' }, technician: null });
  fireEvent.click(screen.getByText('Cancel'));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Discard draft'));
  expect(close).toHaveBeenCalledOnce();
});
it('preserves angle brackets while editing and leaves original HTML untouched until changed', async () => {
  const { invoke } = setup();
  const description = await screen.findByLabelText('description');
  fireEvent.change(description, { target: { value: 'A < B' } });
  expect(description).toHaveValue('A < B');
  fireEvent.click(screen.getByText('Review changes'));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'prepareChange',
        mutation: { kind: 'edit', id: '123', fields: { description: 'A < B' } },
      }),
    ),
  );
});
it('reviews email recipients and never sends when the composer merely opens', async () => {
  const { invoke } = setup('reply');
  await screen.findByLabelText('To');
  expect(screen.getByLabelText('To')).toHaveValue('requester@example.test');
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
  fireEvent.change(screen.getByLabelText('Cc'), { target: { value: 'reviewer@example.test' } });
  fireEvent.click(screen.getByText('Review email'));
  await screen.findByText('Review email before sending');
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
  expect(invoke.mock.calls.find(([c]) => c.action === 'prepareChange')?.[0].mutation).toMatchObject(
    { kind: 'reply', to: ['requester@example.test'], cc: ['reviewer@example.test'], body: 'Hello' },
  );
  fireEvent.click(screen.getByText('Confirm and send'));
  await screen.findByText('Confirmed');
});

it('renders metadata labels, multiline limits and date-only controls without shifting calendar dates', async () => {
  const { invoke } = setup('edit', [
    field('udf_fields.custom_day', 'date', '2026-09-18', { label: 'Date of hire', dateOnly: true }),
    field('udf_fields.udf_char130', 'multiline', 'Details', {
      label: 'Business Justification',
      maxLength: 5000,
    }),
    field('udf_fields.udf_char23', 'text', 'Acme', { label: 'Provider', maxLength: 25 }),
  ]);
  const date = await screen.findByLabelText('Date of hire');
  expect(date).toHaveAttribute('type', 'date');
  expect(date).toHaveValue('2026-09-18');
  expect(screen.getByLabelText('Business Justification').tagName).toBe('TEXTAREA');
  expect(screen.getByLabelText('Business Justification')).toHaveAttribute('maxlength', '5000');
  expect(screen.getByLabelText('Provider')).toHaveAttribute('maxlength', '25');
  fireEvent.change(date, { target: { value: '2026-09-19' } });
  fireEvent.click(screen.getByText('Review changes'));
  await screen.findByRole('region', { name: 'Review SDP change' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: {
      kind: 'edit',
      id: '123',
      fields: { 'udf_fields.custom_day': '2026-09-19' },
    },
  });
});

it('opens forwarding with empty recipients and private visibility, then requires email review', async () => {
  const invoke = vi.fn().mockImplementation(async (c) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      ...(c.action === 'readForwardContext'
        ? {
            replyContext: {
              id: '123',
              to: [],
              cc: [],
              subject: 'Fwd: Sample',
              body: '<p>Original description</p>',
              canReply: true,
            },
          }
        : {
            review: {
              confirmationId: '00000000-0000-4000-8000-000000000001',
              expiresAt: Date.now() + 60000,
              mutation: c.mutation,
            },
          }),
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpNativeEditor ticket={ticket} mode="forward" onClose={vi.fn()} onResult={vi.fn()} />);
  const to = await screen.findByLabelText('To', { exact: true });
  expect(to).toHaveValue('');
  expect(screen.getByLabelText('Message')).toHaveValue('Original description');
  fireEvent.change(to, { target: { value: 'recipient@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await screen.findByRole('button', { name: 'Confirm and send' });
  expect(invoke).toHaveBeenLastCalledWith({
    action: 'prepareChange',
    mutation: expect.objectContaining({
      kind: 'forward',
      to: ['recipient@example.test'],
      isPublic: false,
    }),
  });
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
});
