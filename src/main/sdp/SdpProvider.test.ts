import { describe, expect, it, vi } from 'vitest';
import { projectProperties, SdpProvider, projectTestTicket, projectQueue } from './SdpProvider';
import { loggers } from '../logger';
const fixture = {
  requests: [
    {
      display_id: '810129',
      status: { name: 'Open' },
      priority: { name: 'Low' },
      group: { name: 'NOC' },
    },
  ],
};
describe('SDP provider boundary', () => {
  it('returns bounded field identifiers for rejected writes without exposing provider error text', async () => {
    const remote = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          response_status: {
            status_code: 4000,
            messages: [
              {
                fields: ['category', 'udf_char23', '<script>'],
                message: 'private upstream content',
              },
            ],
          },
        }),
        { status: 400 },
      ),
    );
    const provider = new SdpProvider(remote);
    await expect(
      provider.json(
        'https://support.campingworld.com/app/itdesk/api/v3/requests/123',
        new AbortController().signal,
        { method: 'PUT' },
      ),
    ).rejects.toMatchObject({
      kind: 'invalid',
      message:
        'SDP rejected the change. Check these fields: category, udf_char23. Refresh the ticket before preparing a new change.',
    });
    expect(remote).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 429, 500, 502, 503, 504])(
    'classifies HTTP %s without leaking upstream bodies',
    async (status) => {
      const denialKind = status === 429 ? 'throttled' : 'denied';
      const provider = new SdpProvider(
        vi.fn().mockResolvedValue(new Response('private upstream error', { status })),
      );
      await expect(provider.ticket('token', new AbortController().signal)).rejects.toMatchObject({
        kind: status >= 500 ? 'outage' : denialKind,
        message: 'SDP request could not be completed.',
      });
    },
  );
  it('only requests the approved ticket and fields and derives immutable identity from Zoho', async () => {
    const remote = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ZUID: '123', Email: 'discard@example.test' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)));
    const provider = new SdpProvider(remote);
    const signal = new AbortController().signal;
    expect(await provider.identity('token', signal)).toBe('123');
    expect((await provider.ticket('token', signal)).number).toBe('810129');
    const url = new URL(String(remote.mock.calls[1]![0]));
    expect(url.origin).toBe('https://support.campingworld.com');
    expect(url.searchParams.get('input_data')).toContain('810129');
    expect(url.searchParams.get('input_data')).not.toContain('requester');
    expect(remote.mock.calls[1]![1]?.redirect).toBe('error');
  });
  it.each([
    { requests: [] },
    { requests: [fixture.requests[0], fixture.requests[0]] },
    { requests: [{ display_id: '999' }] },
    { requests: [{ ...fixture.requests[0], requester: { name: 'private' } }] },
  ])('rejects unexpected personal data or results', (value) => {
    expect(() => projectTestTicket(value)).toThrow();
  });
  it.each([
    ['ECONNREFUSED', 'outage'],
    ['ETIMEDOUT', 'outage'],
    ['ENOTFOUND', 'outage'],
    ['CERT_HAS_EXPIRED', 'invalid'],
    ['UNKNOWN', 'invalid'],
  ])('classifies transport failure %s conservatively', async (code, kind) => {
    const provider = new SdpProvider(vi.fn().mockRejectedValue({ cause: { code } }));
    await expect(provider.ticket('token', new AbortController().signal)).rejects.toMatchObject({
      kind,
    });
  });
  it('rejects TLS errors and oversized or malformed bodies without treating them as outages', async () => {
    for (const response of [new Response('x'.repeat(262145)), new Response('not json')]) {
      const provider = new SdpProvider(vi.fn().mockResolvedValue(response));
      await expect(provider.ticket('token', new AbortController().signal)).rejects.toMatchObject({
        kind: 'invalid',
      });
    }
    const provider = new SdpProvider(
      vi.fn().mockRejectedValue({ cause: { code: 'CERT_HAS_EXPIRED' } }),
    );
    await expect(provider.ticket('token', new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('live queue projection and bounded requests', () => {
  const row = {
    id: '123456',
    display_id: '810129',
    subject: 'Synthetic subject',
    status: { name: 'Open' },
    priority: null,
    group: { name: 'NOC' },
    technician: { name: 'Example technician', email_id: 'discard@example.test' },
    created_time: { value: '1000' },
    due_by_time: null,
  };
  const value = (rows: unknown[]) => ({ requests: rows, list_info: { has_more_rows: false } });
  it.each([null, undefined])('retains tickets with an absent subject (%s)', (subject) => {
    const projected = projectQueue(value([{ ...row, subject, group: null }]), 'Unassigned', 2);
    expect(projected.tickets[0]).toMatchObject({ id: row.id, subject: '', group: 'Unassigned' });
  });
  it('still rejects malformed subjects', () => {
    const warn = vi.spyOn(loggers.main, 'warn').mockImplementation(() => undefined);
    try {
      expect(() =>
        projectQueue(value([{ ...row, subject: { private: 'private body' } }]), 'NOC', 0),
      ).toThrow();
      expect(warn).toHaveBeenCalledWith('SDP queue validation failed', {
        issues: [{ path: 'tickets.0.subject', code: 'invalid_type' }],
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private body');
    } finally {
      warn.mockRestore();
    }
  });
  it('drops nested contact fields and distinguishes missing group from missing technician', () => {
    const projected = projectQueue(value([row]), 'NOC', 0);
    expect(projected.tickets[0]?.technician).toBe('Example technician');
    expect(JSON.stringify(projected)).not.toContain('discard@example.test');
    expect(() => projectQueue(value([{ ...row, technician: null }]), 'Unassigned', 0)).toThrow();
    expect(projectQueue(value([{ ...row, group: null }]), 'Unassigned', 0).tickets[0]?.group).toBe(
      'Unassigned',
    );
  });
  it.each([
    { ...row, group: { name: 'SOX' } },
    { ...row, description: 'unrequested' },
    { ...row, requester: { name: 'unrequested' } },
    { ...row, created_time: { value: 'invalid' } },
  ])('rejects unexpected groups, fields or timestamps', (entry) => {
    expect(() => projectQueue(value([entry]), 'NOC', 0)).toThrow();
  });
  it('uses fixed queue criteria, 50-row pagination, and read-only GET requests', async () => {
    const remote = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify(value([]))));
    const provider = new SdpProvider(remote);
    await provider.queue('token', new AbortController().signal, 'NOC', 1);
    const first = JSON.parse(
      new URL(String(remote.mock.calls[0]![0])).searchParams.get('input_data')!,
    );
    expect(first.list_info).toMatchObject({
      start_index: 51,
      row_count: 50,
      search_criteria: { field: 'group.name', value: 'NOC' },
    });
    await provider.queue('token', new AbortController().signal, 'Unassigned', 0);
    const second = JSON.parse(
      new URL(String(remote.mock.calls[1]![0])).searchParams.get('input_data')!,
    );
    expect(second.list_info.search_criteria).toEqual({ field: 'group', condition: 'is' });
    expect(first.list_info.fields_required).not.toContain('requester');
    expect(remote.mock.calls[0]![1]?.method).toBeUndefined();
  });
});

it('reads only the selected request and bounded conversation bodies without exposing raw profiles', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          request: {
            id: '123',
            description: '<p>Example description</p>',
            requester: { email: 'discard@example.test' },
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          notes: [
            {
              id: '789',
              description: '<p>Private note</p>',
              added_by: { name: 'Example technician', email: 'discard@example.test' },
              added_time: { value: '1000' },
            },
          ],
          list_info: { has_more_rows: false },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ conversations: [{ id: '456' }], list_info: { has_more_rows: true } }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          notification: {
            id: '456',
            description: '<p>Example response</p>',
            sender: { name: 'Example author', email: 'discard@example.test' },
            time: { value: '1000' },
          },
        }),
      ),
    );
  const result = await new SdpProvider(fetcher).detail(
    'test',
    new AbortController().signal,
    '123',
    0,
  );
  expect(result.description).toContain('Example description');
  expect(result.conversations[0]?.body).toContain('Example response');
  expect(result.conversations[0]).toMatchObject({ author: 'Example author', createdAt: 1000 });
  expect(result.hasMore).toBe(true);
  expect(result.notes?.[0]?.body).toContain('Private note');
  expect(result.notes?.[0]?.author).toBe('Example technician');
  expect(JSON.stringify(result)).not.toContain('discard@example.test');
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    '/app/itdesk/api/v3/requests/123',
    '/app/itdesk/api/v3/requests/123/notes',
    '/app/itdesk/api/v3/requests/123/conversations',
    '/app/itdesk/api/v3/requests/123/notifications/456',
  ]);
});
it('shows an explicit conversation failure instead of pretending history is empty', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ request: { id: '123', description: 'Example' } })),
    )
    .mockResolvedValueOnce(new Response('', { status: 403 }));
  expect(
    (await new SdpProvider(fetcher).detail('test', new AbortController().signal, '123', 0))
      .conversationError,
  ).toContain('could not be loaded');
});

it('retains request properties and populated form answers without whole user profiles', () => {
  const result = projectProperties({
    requester: { name: 'Example requester', email: 'discard@example.test' },
    impact: { name: 'Single User' },
    urgency: { name: 'Medium' },
    category: { name: 'Software' },
    first_response_due_by_time: { display_value: 'Tomorrow' },
    resolution: { content: 'Handled' },
    udf_fields: { custom_answer: 'Example form value', empty_answer: null },
  });
  expect(result).toEqual(
    expect.arrayContaining([
      { label: 'Requester', value: 'Example requester' },
      { label: 'Impact', value: 'Single User' },
      { label: 'Category', value: 'Software' },
      { label: 'Response due', value: 'Tomorrow' },
      { label: 'Additional fields / custom_answer', value: 'Example form value' },
    ]),
  );
  expect(JSON.stringify(result)).not.toContain('discard@example.test');
  expect(JSON.stringify(result)).not.toContain('empty_answer');
});

it('keeps delta searches scoped to the chosen queue and requests only changes', async () => {
  const remote = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ requests: [], list_info: { has_more_rows: false } })),
    );
  const provider = new SdpProvider(remote);
  await provider.queue('token', new AbortController().signal, 'Unassigned', 0, 123000);
  const input = JSON.parse(
    new URL(String(remote.mock.calls[0]![0])).searchParams.get('input_data')!,
  );
  expect(input.list_info.search_criteria).toEqual({
    field: 'group',
    condition: 'is',
    children: [
      {
        field: 'last_updated_time',
        condition: 'greater or equal',
        value: '123000',
        logical_operator: 'AND',
        children: [
          {
            field: 'created_time',
            condition: 'greater or equal',
            value: '123000',
            logical_operator: 'OR',
          },
        ],
      },
    ],
  });
  expect(input.list_info.sort_field).toBe('last_updated_time');
  expect(input.list_info.fields_required).toContain('last_updated_time');
  expect(input.list_info.fields_required).not.toContain('description');
});
it.each(['120', new Date(Date.now() + 120000).toUTCString()])(
  'honors Retry-After %s without retaining the error body',
  async (retry) => {
    const provider = new SdpProvider(
      vi
        .fn()
        .mockResolvedValue(
          new Response('private', { status: 429, headers: { 'Retry-After': retry } }),
        ),
    );
    const error = await provider
      .queue('token', new AbortController().signal, 'NOC', 0)
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ kind: 'throttled', retryAfterMs: expect.any(Number) });
    expect((error as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(118000);
  },
);

it('accepts newly created tickets with no update timestamp', () => {
  const result = projectQueue(
    {
      requests: [
        {
          id: '1',
          display_id: '1',
          subject: 'Dummy',
          group: { name: 'NOC' },
          created_time: { value: '1000' },
          last_updated_time: null,
        },
      ],
      list_info: { has_more_rows: false },
    },
    'NOC',
    0,
  );
  expect(result.tickets[0]).toMatchObject({ createdAt: 1000, updatedAt: null });
});

it('uses Cloud custom labels in ticket properties without following metadata URLs', async () => {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/requests/123'))
      return {
        request: { id: '123', udf_fields: { udf_char23: 'Acme', udf_char130: 'x'.repeat(5000) } },
      };
    if (path.endsWith('/udf_fields'))
      return {
        udf_fields: [
          {
            module: { name: 'request' },
            field_key: 'udf_char23',
            name: 'Provider',
            type: 'string',
            field_type: 'Single Line',
          },
        ],
        list_info: { has_more_rows: false },
      };
    if (path.endsWith('/notes')) return { notes: [], list_info: { has_more_rows: false } };
    return { conversations: [], list_info: { has_more_rows: false } };
  });
  const detail = await provider.detail('token', AbortSignal.timeout(1000), '123', 0);
  expect(detail.properties).toContainEqual({
    label: 'Additional fields / Provider',
    value: 'Acme',
  });
  expect(detail.properties).toContainEqual({
    label: 'Additional fields / udf_char130',
    value: 'x'.repeat(5000),
  });
  expect(json.mock.calls.map(([url]) => new URL(url).origin)).toEqual(
    expect.arrayContaining(['https://support.campingworld.com']),
  );
});

it.each([false, true])(
  'filters automatic notifications before pagination (include=%s)',
  async (includeAutoNotifications) => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json').mockImplementation(async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/requests/123'))
        return { request: { id: '123', description: 'Original' } };
      if (url.pathname.endsWith('/notes'))
        return { notes: [], list_info: { has_more_rows: false } };
      if (url.pathname.endsWith('/conversations'))
        return {
          conversations: [{ id: '456', type: 'Technician_E-Mail' }],
          list_info: { has_more_rows: true },
        };
      if (url.pathname.endsWith('/notifications/456'))
        return {
          notification: {
            id: '456',
            subject: 'Acknowledgment',
            sender: { name: 'System' },
            description: 'A real reply with a misleading sender name',
            time: { value: '1000' },
          },
        };
      throw new Error('Unexpected endpoint');
    });
    const result = await provider.detail(
      'token',
      new AbortController().signal,
      '123',
      2,
      includeAutoNotifications,
    );
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]?.body).toContain('real reply');
    expect(result.includeAutoNotifications).toBe(includeAutoNotifications);
    expect(result.hasMore).toBe(true);
    const query = new URL(json.mock.calls.find(([url]) => url.includes('/conversations?'))![0]);
    const { list_info: list } = JSON.parse(query.searchParams.get('input_data')!);
    expect(list).toMatchObject({
      row_count: 10,
      start_index: 21,
      sort_field: 'created_time',
      sort_order: 'desc',
    });
    expect(list.search_criteria).toMatchObject({
      field: 'type',
      condition: 'neq',
      values: ['NOTES'],
    });
    expect(list.search_criteria.children).toContainEqual({
      field: 'type',
      condition: 'neq',
      values: ['ApprovalComments'],
      logical_operator: 'and',
    });
    const systemFilter = list.search_criteria.children.find(
      (item: { field: string }) => item.field === 'created_by.user_type',
    );
    expect(systemFilter).toEqual(
      includeAutoNotifications
        ? undefined
        : {
            field: 'created_by.user_type',
            condition: 'neq',
            values: ['1'],
            logical_operator: 'and',
          },
    );
  },
);
