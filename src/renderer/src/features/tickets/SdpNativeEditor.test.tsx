import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { changeSummary, SdpNativeEditor, SdpNativeField } from './SdpNativeEditor';
import { chooseSdpOption, sdpPicker } from './sdpPicker.test-util';
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
  await chooseSdpOption('status', 'Closed');
  fireEvent.click(screen.getByText('Review Changes'));
  await screen.findByRole('region', { name: 'Review SDP change' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: { kind: 'edit', id: '123', fields: { status: { id: '2', name: 'Closed' } } },
  });
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
  fireEvent.click(screen.getByText('Save'));
  await screen.findByText('Confirmed');
});
it('clears dependent technician when group changes and guards unsaved drafts', async () => {
  const { invoke, close } = setup();
  await screen.findByLabelText('group');
  await chooseSdpOption('group', 'SOX');
  expect(sdpPicker('technician')).toHaveTextContent('Not set');
  fireEvent.click(screen.getByText('Review Changes'));
  await screen.findByRole('region', { name: 'Review SDP change' });
  expect(
    invoke.mock.calls.find(([c]) => c.action === 'prepareChange')?.[0].mutation.fields,
  ).toEqual({ group: { id: '4', name: 'SOX' }, technician: null });
  fireEvent.click(screen.getByText('Cancel'));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Discard Draft'));
  expect(close).toHaveBeenCalledOnce();
});
it('preserves angle brackets while editing and leaves original HTML untouched until changed', async () => {
  const { invoke } = setup();
  const description = await screen.findByLabelText('description');
  fireEvent.change(description, { target: { value: 'A < B' } });
  expect(description).toHaveValue('A < B');
  fireEvent.click(screen.getByText('Review Changes'));
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
  fireEvent.click(screen.getByText('Review Email'));
  await screen.findByText('Review email before sending');
  expect(invoke.mock.calls.some(([c]) => c.action === 'confirmChange')).toBe(false);
  expect(invoke.mock.calls.find(([c]) => c.action === 'prepareChange')?.[0].mutation).toMatchObject(
    { kind: 'reply', to: ['requester@example.test'], cc: ['reviewer@example.test'], body: 'Hello' },
  );
  fireEvent.click(screen.getByText('Confirm and Send'));
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
  fireEvent.click(screen.getByText('Review Changes'));
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
  fireEvent.click(screen.getByRole('button', { name: 'Review Email' }));
  await screen.findByRole('button', { name: 'Confirm and Send' });
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

it('shows an unset text field as empty and lets the operator clear a value', async () => {
  setup('edit', [
    field('udf_fields.empty', 'text', null, { label: 'Empty field' }),
    field('udf_fields.filled', 'text', 'Acme', { label: 'Provider' }),
  ]);
  const empty = await screen.findByLabelText('Empty field');
  expect(empty).toHaveValue('');
  const provider = screen.getByLabelText('Provider');
  fireEvent.change(provider, { target: { value: '' } });
  expect(provider).toHaveValue('');
});
it('renders SDP Check Box fields as checkboxes and submits the checked values', async () => {
  const { invoke } = setup('edit', [
    field('subject', 'text', 'Example ticket'),
    field('udf_fields.txt_major_incident', 'choice', [], {
      label: 'Major Incident',
      multiple: true,
      choices: [{ label: 'Yes', value: 'Yes' }],
    }),
    field('udf_fields.txt_regions', 'choice', ['East'], {
      label: 'Regions',
      multiple: true,
      choices: [
        { label: 'East', value: 'East' },
        { label: 'West', value: 'West' },
      ],
    }),
  ]);
  const major = await screen.findByRole('checkbox', { name: 'Major Incident' });
  expect(major).not.toBeChecked();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  const regions = screen.getByRole('group', { name: 'Regions' });
  expect(within(regions).getByRole('checkbox', { name: 'East' })).toBeChecked();
  fireEvent.click(major);
  fireEvent.click(within(regions).getByRole('checkbox', { name: 'West' }));
  fireEvent.click(screen.getByText('Review Changes'));
  await screen.findByRole('region', { name: 'Review SDP change' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'prepareChange',
    mutation: {
      kind: 'edit',
      id: '123',
      fields: {
        'udf_fields.txt_major_incident': ['Yes'],
        'udf_fields.txt_regions': ['East', 'West'],
      },
    },
  });
});
it('folds sections of optional, empty custom fields until the operator shows them', async () => {
  setup('edit', [
    field('subject', 'text', 'Example ticket'),
    field('udf_fields.location', 'text', null, { label: 'Location code' }),
    field('udf_fields.wd_criteria', 'text', null, {
      label: 'WD Criteria',
      section: 'Workday Details',
    }),
    field('udf_fields.cost', 'number', null, {
      label: 'Estimated Costs',
      section: 'Facilities Details',
    }),
    field('udf_fields.cause', 'text', null, {
      label: 'Root cause',
      section: 'Review',
      required: true,
    }),
    // SDP names a custom field without a display name by its internal name.
    field('udf_fields.udf_char110', 'text', null, { label: 'udf_char110' }),
    field('udf_fields.udf_char111', 'text', 'Kept value', { label: 'udf_char111' }),
  ]);
  // A custom field beside standard fields, or a required one, stays in view.
  expect(await screen.findByLabelText('Location code')).toBeVisible();
  expect(screen.getByLabelText('Root cause *')).toBeVisible();
  // An unnamed one stays out of the form unless it holds a value.
  expect(screen.queryByLabelText('udf_char110')).not.toBeInTheDocument();
  expect(screen.getByLabelText('udf_char111')).toHaveValue('Kept value');
  expect(screen.queryByLabelText('WD Criteria')).not.toBeInTheDocument();
  expect(screen.getByText('Workday Details, Facilities Details')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show 2 Empty Custom Sections' }));
  fireEvent.change(screen.getByLabelText('WD Criteria'), { target: { value: 'Training' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hide Empty Custom Sections' }));
  // A section with a pending value never folds away.
  expect(screen.getByLabelText('WD Criteria')).toHaveValue('Training');
  expect(screen.queryByLabelText('Estimated Costs')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show 1 Empty Custom Section' })).toBeVisible();
});

it('loads the reply once even when development mode replays the load and SDP is busy', async () => {
  let running = false;
  // The broker runs one read at a time and refuses a second one while the first is in flight.
  const sdpAccount = vi.fn().mockImplementation(async () => {
    if (running) return { success: false, error: 'SDP could not complete this action.' };
    running = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    running = false;
    return {
      success: true,
      data: {
        configured: true,
        status: 'connected',
        replyContext: {
          id: '123',
          subject: 'Re: Example ticket',
          to: ['requester@example.test'],
          cc: [],
          canReply: true,
        },
      },
    };
  });
  globalThis.api = { ...original, sdpAccount } as BridgeAPI;
  render(
    <StrictMode>
      <SdpNativeEditor ticket={ticket} mode="reply" onClose={vi.fn()} onResult={vi.fn()} />
    </StrictMode>,
  );
  const draft = screen.getByRole('region', { name: 'Reply to ticket' });
  await waitFor(() =>
    expect(within(draft).getByLabelText('To')).toHaveValue('requester@example.test'),
  );
  expect(within(draft).queryByRole('alert')).not.toBeInTheDocument();
  expect(sdpAccount).toHaveBeenCalledTimes(1);
});
it('marks each changed field with its saved value and undoes it in place', async () => {
  setup();
  await screen.findByLabelText('status');
  const review = screen.getByRole('button', { name: 'Review Changes' });
  expect(screen.getByText('No changes yet')).toBeInTheDocument();
  expect(review).toBeDisabled();
  await chooseSdpOption('status', 'Closed');
  expect(screen.getByText('1 change: status')).toBeInTheDocument();
  expect(screen.getByText('Was Open')).toBeInTheDocument();
  expect(review).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo status' }));
  expect(sdpPicker('status')).toHaveTextContent('Open');
  expect(screen.queryByText('Was Open')).not.toBeInTheDocument();
  expect(screen.getByText('No changes yet')).toBeInTheDocument();
});
it('summarizes changes by field name and counts the rest', () => {
  expect(changeSummary([])).toBe('No changes yet');
  expect(changeSummary(['Status', 'Priority'])).toBe('2 changes: Status, Priority');
  expect(changeSummary(['Status', 'Priority', 'Group', 'Technician', 'Impact'])).toBe(
    '5 changes: Status, Priority, Group and 2 more',
  );
});
it('searches a long SDP lookup inside its list and toggles several choices', async () => {
  const invoke = vi.fn().mockImplementation(async (command) => ({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      options: {
        field: 'requesters',
        hasMore: false,
        choices: (command.search
          ? [{ id: '3', name: 'Morgan' }]
          : [
              { id: '1', name: 'Avery' },
              { id: '2', name: 'Blair' },
            ]
        ).map((value) => ({ label: value.name, value })),
      },
    },
  }));
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  const change = vi.fn();
  const avery = { id: '1', name: 'Avery' };
  render(
    <SdpNativeField
      id="123"
      field={field('requesters', 'lookup', null, { multiple: true, dependencies: ['site'] })}
      value={[avery]}
      values={{ site: { id: '9', name: 'HQ' } }}
      disabled={false}
      onChange={change}
    />,
  );
  const picker = sdpPicker('requesters');
  expect(picker).toHaveTextContent('Avery');
  fireEvent.click(picker);
  await screen.findByRole('option', { name: 'Blair' });
  expect(invoke).toHaveBeenCalledWith({
    action: 'readOptions',
    id: '123',
    field: 'requesters',
    search: '',
    page: 0,
    dependencies: { site: { id: '9', name: 'HQ' } },
  });
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
  // The current choice is listed once, marked, so it can be removed again.
  expect(screen.getAllByRole('option', { name: 'Avery' })).toHaveLength(1);
  expect(screen.getByRole('option', { name: 'Avery' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('option', { name: 'Blair' }));
  expect(change).toHaveBeenLastCalledWith([avery, { id: '2', name: 'Blair' }]);
  // A multi-select list stays open for further choices.
  fireEvent.click(screen.getByRole('option', { name: 'Avery' }));
  expect(change).toHaveBeenLastCalledWith([]);
  fireEvent.change(screen.getByRole('combobox', { name: 'Search requesters choices' }), {
    target: { value: 'mor' },
  });
  await screen.findByRole('option', { name: 'Morgan' });
  expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'mor', page: 0 }));
});
it('filters a fixed choice list as the person types and clears with Not set', async () => {
  globalThis.api = { ...original, sdpAccount: vi.fn() } as BridgeAPI;
  const change = vi.fn();
  render(
    <SdpNativeField
      id="123"
      field={field('impact', 'choice', null, {
        choices: ['Low', 'Medium', 'High'].map((name, index) => ({
          label: name,
          value: { id: String(index), name },
        })),
      })}
      value={{ id: '2', name: 'High' }}
      values={{}}
      disabled={false}
      onChange={change}
    />,
  );
  fireEvent.click(sdpPicker('impact'));
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Not set',
    'Low',
    'Medium',
    'High',
  ]);
  fireEvent.change(screen.getByRole('combobox', { name: 'Search impact choices' }), {
    target: { value: 'med' },
  });
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Medium']);
  fireEvent.change(screen.getByRole('combobox', { name: 'Search impact choices' }), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('option', { name: 'Not set' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(null);
  expect(globalThis.api!.sdpAccount).not.toHaveBeenCalled();
});
