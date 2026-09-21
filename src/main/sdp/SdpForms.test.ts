import { describe, expect, it, vi } from 'vitest';
import { SdpProvider, SdpProviderError } from './SdpProvider';
import {
  editedRequest,
  readForm,
  readOptions,
  readReplyContext,
  readStandardOptions,
  validateFormMutation,
} from './SdpForms';
import { submitMutation } from './SdpMutations';
import { SdpOptionsCommandSchema, type SdpFieldValue } from '@shared/sdpForm';
function setup() {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url, _signal, init) => {
    const path = new URL(url).pathname;
    if (init?.method)
      return { response_status: { status_code: 2000 }, request: { id: '123', display_id: '7' } };
    if (path.endsWith('/notifications/_links'))
      return { _links: [{ name: 'add', method: 'post' }] };
    if (path.endsWith('/_links'))
      return {
        _links: { links: [{ name: 'edit', method: 'put', non_editable_fields: ['created_time'] }] },
      };
    if (path.endsWith('/udf_fields'))
      return {
        udf_fields: [
          {
            field_key: 'txt_major_incident',
            name: 'Major incident',
            type: 'multi_select',
            field_type: 'Check Box',
            module: { name: 'request' },
            constraints: [],
          },
          {
            field_key: 'udf_char1',
            name: 'Location',
            type: 'string',
            field_type: 'Single Line',
            module: { name: 'request' },
            constraints: [],
          },
          {
            field_key: 'secret_not_in_template',
            name: 'Hidden',
            type: 'string',
            field_type: 'Single Line',
            module: { name: 'request' },
            constraints: [],
          },
        ],
        list_info: { has_more_rows: false },
      };
    if (path.endsWith('/_get_template_with_layout'))
      return {
        request_template: {
          layouts: [
            {
              name: 'technician_layout',
              sections: [
                {
                  name: 'Details',
                  fields: [
                    'subject',
                    'description',
                    'status',
                    'group',
                    'technician',
                    'created_time',
                    'udf_fields.txt_major_incident',
                    'udf_fields.udf_char1',
                  ].map((name) => ({ name, mandatory: name === 'subject' })),
                },
              ],
            },
          ],
        },
      };
    if (path.endsWith('/_allowed_values_for_fields'))
      return {
        allowed_values: {
          status: [
            { id: '1', name: 'Open' },
            { id: '2', name: 'Closed' },
          ],
          udf_fields: { txt_major_incident: [{ value: 'Yes', display_value: 'Yes' }] },
        },
      };
    if (path.endsWith('/group'))
      return { groups: [{ id: '9', name: 'Example group' }], list_info: { has_more_rows: true } };
    if (path.endsWith('/technician'))
      return { technician: [{ id: '11', name: 'Operator' }], list_info: { has_more_rows: false } };
    return {
      request: {
        id: '123',
        template: { id: '7', name: 'Example incident' },
        subject: 'Test',
        description: '<p>Unchanged formatting</p>',
        requester: { email_id: 'requester@example.test' },
        status: { id: '1', name: 'Open' },
        udf_fields: { txt_major_incident: [], udf_char1: 'A' },
      },
    };
  });
  return { provider, json, signal: new AbortController().signal };
}
describe('native SDP template forms', () => {
  it('scopes technician choices to associated sites and groups using the Cloud lookup keys', async () => {
    const { provider, json, signal } = setup();
    const form = await readForm(provider, 'token', signal, '123');
    await readOptions(
      provider,
      'token',
      signal,
      {
        action: 'readOptions',
        id: '123',
        field: 'technician',
        page: 0,
        search: '',
        dependencies: { site: { id: '3' }, group: { id: '9' } },
      },
      form,
    );
    const input = JSON.parse(new URL(json.mock.lastCall![0]).searchParams.get('input_data')!);
    expect(input.list_info.search_criteria).toEqual([
      { field: 'associated_sites.id', condition: 'is', value: '3', logical_operator: 'and' },
      { field: 'groups.id', condition: 'is', value: '9', logical_operator: 'and' },
      { field: 'name', condition: 'like', values: [''], logical_operator: 'and' },
    ]);
  });
  it('projects only active template fields and preserves provider edit restrictions', async () => {
    const { provider, signal } = setup();
    const form = await readForm(provider, 'token', signal, '123');
    expect(form.fields.find((f) => f.key === 'created_time')?.readOnly).toBe(true);
    expect(form.fields.some((f) => f.key.includes('secret'))).toBe(false);
    expect(form.fields.find((f) => f.key === 'status')?.choices).toEqual([
      { label: 'Open', value: { id: '1', name: 'Open' } },
      { label: 'Closed', value: { id: '2', name: 'Closed' } },
    ]);
    expect(form.fields.find((f) => f.key === 'udf_fields.txt_major_incident')).toMatchObject({
      kind: 'choice',
      multiple: true,
    });
  });
  it('uses a fixed tenant endpoint, scoped dependencies and paginated lookup search', async () => {
    const { provider, json, signal } = setup();
    const form = await readForm(provider, 'token', signal, '123');
    const command = SdpOptionsCommandSchema.parse({
      action: 'readOptions',
      id: '123',
      field: 'group',
      page: 1,
      search: 'Example',
      dependencies: { site: { id: '3' } },
    });
    expect(await readOptions(provider, 'token', signal, command, form)).toMatchObject({
      hasMore: true,
      choices: [{ label: 'Example group' }],
    });
    const url = new URL(json.mock.lastCall![0]);
    expect(url.origin).toBe('https://support.campingworld.com');
    expect(JSON.parse(url.searchParams.get('input_data')!)).toMatchObject({
      list_info: {
        start_index: 51,
        search_criteria: [
          { field: 'site.id', condition: 'is', value: '3' },
          { field: 'name', values: ['Example'] },
        ],
      },
    });
    await expect(
      readOptions(
        provider,
        'token',
        signal,
        { ...command, dependencies: { requester: { id: '4' } } },
        form,
      ),
    ).rejects.toThrow();
    expect(SdpOptionsCommandSchema.safeParse({ ...command, field: '../../users' }).success).toBe(
      false,
    );
  });
  it('rejects read-only, unknown and invalid values before any live write', async () => {
    const { provider, json, signal } = setup();
    const invalidFields: Record<string, SdpFieldValue>[] = [
      { created_time: 10 },
      { 'udf_fields.secret_not_in_template': 'bad' },
      { subject: null },
      { status: { id: '999' } },
      { 'udf_fields.txt_major_incident': 'Yes' },
    ];
    for (const fields of invalidFields)
      await expect(
        validateFormMutation(provider, 'token', signal, { kind: 'edit', id: '123', fields }),
      ).rejects.toThrow();
    expect(json.mock.calls.every((c) => !c[2]?.method)).toBe(true);
  });
  it('writes only changed fields using IDs and retains checkbox arrays and explicit clears', async () => {
    const { provider, json, signal } = setup();
    await submitMutation(provider, 'token', signal, {
      kind: 'edit',
      id: '123',
      fields: {
        status: { id: '2', name: 'Closed' },
        group: null,
        'udf_fields.txt_major_incident': ['Yes'],
        'udf_fields.udf_char1': null,
      },
    });
    const call = json.mock.lastCall!;
    expect(call[2]?.method).toBe('PUT');
    expect(JSON.parse(new URLSearchParams(call[2]?.body as string).get('input_data')!)).toEqual({
      request: {
        status: { id: '2' },
        group: null,
        udf_fields: { txt_major_incident: ['Yes'], udf_char1: null },
      },
    });
  });
  it('sends a real notification payload, with reviewed recipients and escaped operator text', async () => {
    const { provider, json, signal } = setup();
    await submitMutation(provider, 'token', signal, {
      kind: 'reply',
      id: '123',
      to: ['requester@example.test'],
      cc: [],
      bcc: [],
      subject: 'Re: Test',
      body: '<script>unsafe</script>\nHello',
      isPublic: true,
    });
    const call = json.mock.lastCall!;
    expect(call[0]).toMatch(/\/123\/notifications$/);
    expect(call[2]?.method).toBe('POST');
    expect(JSON.parse(new URLSearchParams(call[2]?.body as string).get('input_data')!)).toEqual({
      notification: {
        to: ['requester@example.test'],
        cc: [],
        bcc: [],
        subject: 'Re: Test',
        description: '&lt;script&gt;unsafe&lt;/script&gt;<br>Hello',
        is_public: true,
        type: 'REQREPLY',
        in_reply_to: { id: '123' },
      },
    });
  });
});

it.each([401, 403, 404])(
  'loads and saves supported template fields when optional metadata returns %s',
  async (status) => {
    const { provider, json, signal } = setup();
    const original = json.getMockImplementation()!;
    json.mockImplementation(async (...args) => {
      if (new URL(args[0]).pathname.endsWith('/udf_fields'))
        throw new SdpProviderError('denied', 0, 'http', status);
      return original(...args);
    });
    const form = await readForm(provider, 'token', signal, '123');
    expect(form).toMatchObject({ canEdit: true, metadataAvailable: false });
    expect(form.fields.find((f) => f.key === 'technician')).toMatchObject({
      kind: 'lookup',
      dependencies: ['site', 'group'],
    });
    expect(form.fields.find((f) => f.key === 'created_time')?.readOnly).toBe(true);
    expect(form.fields.find((f) => f.key === 'udf_fields.txt_major_incident')).toMatchObject({
      multiple: true,
      kind: 'choice',
    });
    await submitMutation(provider, 'token', signal, {
      kind: 'edit',
      id: '123',
      fields: { subject: 'Updated', technician: null },
    });
    expect(json.mock.lastCall![2]?.method).toBe('PUT');
  },
);

it('does not fall back for an outage or authorize an edit without live permissions', async () => {
  const { provider, json, signal } = setup();
  const original = json.getMockImplementation()!;
  json.mockImplementation(async (...args) => {
    if (new URL(args[0]).pathname.endsWith('/udf_fields')) throw new SdpProviderError('outage');
    return original(...args);
  });
  await expect(readForm(provider, 'token', signal, '123')).rejects.toMatchObject({
    kind: 'outage',
  });
  json.mockImplementation(async (...args) => {
    if (new URL(args[0]).pathname.endsWith('/_links')) return { _links: [] };
    return original(...args);
  });
  await expect(
    validateFormMutation(provider, 'token', signal, {
      kind: 'edit',
      id: '123',
      fields: { subject: 'No' },
    }),
  ).rejects.toThrow();
  expect(json.mock.calls.some((c) => c[2]?.method)).toBe(false);
});

it('uses live labels and limits, preserves date-only values and writes metadata-defined dates correctly', async () => {
  const { provider, json, signal } = setup();
  const original = json.getMockImplementation()!;
  json.mockImplementation(async (...args) => {
    const raw = (await original(...args)) as Record<string, unknown>;
    const path = new URL(args[0]).pathname;
    if (path.endsWith('/udf_fields'))
      return {
        udf_fields: [
          {
            field_key: 'udf_char1',
            name: 'Provider',
            type: 'string',
            field_type: 'Single Line',
            module: { name: 'request' },
            constraints: [
              { constraint_name: 'max_length', constraint_value: '25' },
              { constraint_name: 'min_length', constraint_value: '2' },
            ],
          },
          {
            field_key: 'custom_date',
            name: 'Date of hire',
            type: 'datestamp',
            field_type: 'Datestamp',
            module: { name: 'request' },
          },
        ],
        list_info: { has_more_rows: false },
      };
    if (path.endsWith('/_get_template_with_layout'))
      return {
        request_template: {
          layouts: [
            {
              name: 'technician_layout',
              sections: [
                {
                  name: 'Details',
                  fields: [{ name: 'udf_fields.udf_char1' }, { name: 'udf_fields.custom_date' }],
                },
              ],
            },
          ],
        },
      };
    if (path.endsWith('/123') && !args[2]?.method)
      return {
        request: {
          ...(raw.request as object),
          udf_fields: { custom_date: { value: '2026-09-18' } },
        },
      };
    return raw;
  });
  const form = await readForm(provider, 'token', signal, '123');
  expect(form.fields[0]).toMatchObject({ label: 'Provider', maxLength: 25, minLength: 2 });
  expect(form.fields[1]).toMatchObject({
    label: 'Date of hire',
    kind: 'date',
    dateOnly: true,
    value: '2026-09-18',
  });
  const invalid: Record<string, SdpFieldValue>[] = [
    { 'udf_fields.udf_char1': 'a' },
    { 'udf_fields.udf_char1': 'x'.repeat(26) },
    { 'udf_fields.custom_date': '2026-02-31' },
  ];
  for (const fields of invalid)
    await expect(
      validateFormMutation(provider, 'token', signal, { kind: 'edit', id: '123', fields }),
    ).rejects.toThrow();
  await submitMutation(provider, 'token', signal, {
    kind: 'edit',
    id: '123',
    fields: { 'udf_fields.custom_date': '2026-09-19' },
  });
  expect(
    JSON.parse(new URLSearchParams(json.mock.lastCall![2]?.body as string).get('input_data')!),
  ).toEqual({ request: { udf_fields: { custom_date: { value: '2026-09-19' } } } });
});

it('propagates a real ticket denial after setup metadata is denied', async () => {
  const { provider, json, signal } = setup();
  const original = json.getMockImplementation()!;
  let reads = 0;
  json.mockImplementation(async (...args) => {
    const path = new URL(args[0]).pathname;
    if (path.endsWith('/udf_fields')) throw new SdpProviderError('denied', 0, 'http', 401);
    if (path.endsWith('/123') && ++reads > 1) throw new SdpProviderError('denied', 0, 'http', 403);
    return original(...args);
  });
  await expect(readForm(provider, 'token', signal, '123')).rejects.toMatchObject({
    kind: 'denied',
    httpStatus: 403,
  });
});

it('anchors message forwarding to the authorized request and starts without recipients', async () => {
  const { provider, json, signal } = setup();
  const original = json.getMockImplementation()!;
  const body = '<p>' + 'Message content '.repeat(100) + '</p>';
  json.mockImplementation(async (...args) => {
    if (new URL(args[0]).pathname.endsWith('/123/notifications/77'))
      return { notification: { id: '77', subject: 'Selected message', description: body } };
    return original(...args);
  });
  const context = await readReplyContext(provider, 'token', signal, '123', true, '77');
  expect(context).toMatchObject({ to: [], cc: [], body, canReply: true });
  expect(context.subject).toContain('Selected message');
  expect(context.subject).toMatch(/^Fwd:/);
  json.mockImplementation(async (...args) => {
    if (new URL(args[0]).pathname.endsWith('/123/notifications/77'))
      return { notification: { id: '78', description: 'Different message' } };
    return original(...args);
  });
  await expect(readReplyContext(provider, 'token', signal, '123', true, '77')).rejects.toThrow();
});

it('loads bounded account-scoped choices and filters technicians by the selected group', async () => {
  const { provider, json, signal } = setup();
  json.mockResolvedValue({
    technician: [
      { id: '9', name: 'Example' },
      { id: '10', name: 'Deleted', deleted: true },
    ],
    list_info: { has_more_rows: true },
  });
  const result = await readStandardOptions(provider, 'token', signal, {
    action: 'readStandardOptions',
    field: 'technician',
    groupId: '4',
    search: 'Example',
    page: 1,
  });
  const url = new URL(json.mock.lastCall![0]);
  expect(url.pathname).toBe('/app/itdesk/api/v3/requests/technician');
  expect(JSON.parse(url.searchParams.get('input_data')!)).toMatchObject({
    list_info: {
      start_index: 51,
      row_count: 50,
      search_criteria: [
        { field: 'name', values: ['Example'] },
        { field: 'groups.id', value: '4' },
      ],
    },
  });
  expect(result).toEqual({
    field: 'technician',
    hasMore: true,
    choices: [{ label: 'Example', value: { id: '9', name: 'Example' } }],
  });
  json.mockResolvedValue({ unexpected: [] });
  await expect(
    readStandardOptions(provider, 'token', signal, {
      action: 'readStandardOptions',
      field: 'group',
      search: '',
      page: 0,
    }),
  ).rejects.toThrow();
});

describe('rich-text mutation boundary', () => {
  it('retains explicit clears and passes only text to HTML encoding', () => {
    const html = vi.fn((value: string) => `encoded:${value}`);
    expect(editedRequest({ description: null, 'resolution.content': 'fixed' }, html)).toEqual({
      description: null,
      resolution: { content: 'encoded:fixed' },
    });
    expect(html).toHaveBeenCalledExactlyOnceWith('fixed');
    for (const value of [true, 123, ['text'], { id: '123' }]) {
      expect(() => editedRequest({ description: value }, html)).toThrow(SdpProviderError);
    }
  });
});
