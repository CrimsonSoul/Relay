import { describe, expect, it, vi } from 'vitest';
import { SdpProvider, SdpProviderError, SdpValidationError } from './SdpProvider';
import { SdpChangeNotAppliedError, submitMutation } from './SdpMutations';
import { loggers } from '../logger';
import { SdpMutationSchema, SDP_DEFAULT_INCIDENT_TEMPLATE } from '@shared/sdpMutation';
describe('SDP mutation boundary', () => {
  it('only submits supported fields and encodes operator text as text', async () => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json').mockResolvedValue({
      response_status: { status_code: 2000 },
      request: { id: '123', display_id: '7' },
    });
    await submitMutation(provider, 'token', new AbortController().signal, {
      kind: 'create',
      majorIncident: true,
      fields: { subject: 'Test', description: '<img src=x>\nTest', group: 'NOC' },
      templateId: SDP_DEFAULT_INCIDENT_TEMPLATE.id,
    });
    const input = JSON.parse(
      new URLSearchParams(json.mock.calls[0]![2]?.body as string).get('input_data')!,
    );
    expect(input).toEqual({
      request: {
        subject: 'Test',
        description: '&lt;img src=x&gt;<br>Test',
        group: { name: 'NOC' },
        template: { id: SDP_DEFAULT_INCIDENT_TEMPLATE.id },
        udf_fields: { txt_major_incident: ['Yes'] },
      },
    });
    expect(
      SdpMutationSchema.safeParse({ kind: 'update', id: '../anything', fields: { status: 'Open' } })
        .success,
    ).toBe(false);
    expect(
      SdpMutationSchema.safeParse({ kind: 'update', id: '1', fields: { arbitrary: true } }).success,
    ).toBe(false);
  });
  it('writes chosen values by SDP ID, request type included, and names the rest', async () => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json').mockResolvedValue({
      response_status: { status_code: 2000 },
      request: { id: '123', display_id: '7' },
    });
    const mutation = SdpMutationSchema.parse({
      kind: 'create',
      majorIncident: false,
      fields: { subject: 'Test', requestType: 'Incident', priority: 'High', group: null },
      fieldIds: { requestType: '11' },
    });
    await submitMutation(provider, 'token', new AbortController().signal, mutation);
    const input = JSON.parse(
      new URLSearchParams(json.mock.calls[0]![2]?.body as string).get('input_data')!,
    );
    expect(input).toEqual({
      request: {
        subject: 'Test',
        request_type: { id: '11' },
        priority: { name: 'High' },
        group: null,
      },
    });
  });
  it('keeps notes private unless explicitly reviewed as requester-visible', async () => {
    const provider = new SdpProvider();
    const json = vi
      .spyOn(provider, 'json')
      .mockResolvedValue({ response_status: { status_code: 2000 } });
    await submitMutation(provider, 'token', new AbortController().signal, {
      kind: 'note',
      id: '123',
      body: 'Internal',
      showToRequester: false,
    });
    const input = JSON.parse(
      new URLSearchParams(json.mock.calls[0]![2]?.body as string).get('input_data')!,
    );
    expect(input.request_note).toMatchObject({
      show_to_requester: false,
      notify_technician: false,
      add_to_linked_requests: false,
    });
  });
  it('preserves full-length subjects and only checks Major Incident for an explicit major create', async () => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json').mockResolvedValue({
      response_status: { status_code: 2000 },
      request: { id: '123' },
    });
    const subject = 'A'.repeat(250);
    for (const majorIncident of [true, false]) {
      const mutation = SdpMutationSchema.parse({
        kind: 'create',
        fields: { subject },
        majorIncident,
      });
      await submitMutation(provider, 'token', new AbortController().signal, mutation);
      const input = JSON.parse(
        new URLSearchParams(json.mock.lastCall![2]?.body as string).get('input_data')!,
      );
      expect(input.request.subject).toBe(subject);
      expect(input.request.udf_fields).toEqual(
        majorIncident ? { txt_major_incident: ['Yes'] } : undefined,
      );
      expect(input.request.template).toEqual(
        majorIncident ? { id: SDP_DEFAULT_INCIDENT_TEMPLATE.id } : undefined,
      );
    }
    expect(
      SdpMutationSchema.safeParse({
        kind: 'create',
        fields: { subject },
        majorIncident: true,
        templateId: '42',
      }).success,
    ).toBe(false);
  });
});

it('forwards with explicit recipients, private visibility and the Cloud forward type', async () => {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url, _signal, init) => {
    if (init?.method) return { response_status: { status_code: 2000 } };
    if (url.includes('/notifications/_links')) return { _links: [{ name: 'add', method: 'post' }] };
    return {
      request: {
        id: '123',
        subject: 'Synthetic',
        requester: { email_id: 'requester@example.test' },
      },
    };
  });
  await submitMutation(provider, 'token', new AbortController().signal, {
    kind: 'forward',
    id: '123',
    to: ['recipient@example.test'],
    cc: [],
    bcc: [],
    subject: 'Fwd: Synthetic',
    body: '<script>not executable</script>',
    isPublic: false,
  });
  const call = json.mock.calls.find((c) => c[2]?.method)!;
  expect(call[0]).toMatch(/\/requests\/123\/notifications$/);
  expect(
    JSON.parse(new URLSearchParams(call[2]!.body as string).get('input_data')!).notification,
  ).toMatchObject({
    type: 'REQFORWARD',
    in_reply_to: { id: '123' },
    to: ['recipient@example.test'],
    is_public: false,
    description: '&lt;script&gt;not executable&lt;/script&gt;',
  });
});

it('picks up only when SDP offers Pick Up for the ticket', async () => {
  const provider = new SdpProvider();
  let offered = true;
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url, _signal, init) => {
    if (init?.method) return { response_status: { status_code: 2000 }, request: { id: '123' } };
    if (url.includes('/_links'))
      return {
        _links: offered ? [{ name: 'pickup', method: 'put' }] : [{ name: 'edit', method: 'put' }],
      };
    return { request: { id: '123' } };
  });
  const signal = new AbortController().signal;
  await expect(
    submitMutation(provider, 'token', signal, { kind: 'pickup', id: '123' }),
  ).resolves.toEqual({
    id: '123',
    number: '123',
    kind: 'pickup',
  });
  const call = json.mock.calls.find((c) => c[2]?.method)!;
  expect(call[0]).toMatch(/\/requests\/123\/_pickup$/);
  expect(call[2]!.method).toBe('PUT');
  expect(new URLSearchParams(call[2]!.body as string).get('input_data')).toBe('{}');
  offered = false;
  json.mockClear();
  await expect(
    submitMutation(provider, 'token', signal, { kind: 'pickup', id: '123' }),
  ).rejects.toThrow('SDP does not offer Pick Up on this ticket.');
  expect(json.mock.calls.some((c) => c[2]?.method)).toBe(false);
});

describe('ambiguous update verification', () => {
  const signal = new AbortController().signal;
  const update = SdpMutationSchema.parse({
    kind: 'update',
    id: '123',
    fields: { status: 'Closed', group: 'NOC' },
  });
  function setup(write: unknown, read: () => unknown) {
    const provider = new SdpProvider();
    const warn = vi.spyOn(loggers.main, 'warn').mockImplementation(() => undefined);
    const json = vi.spyOn(provider, 'json').mockImplementation(async (_url, _signal, init) => {
      if (init?.method) throw write;
      return read();
    });
    return { provider, json, warn };
  }
  const reads = (json: ReturnType<typeof setup>['json']) =>
    json.mock.calls.filter((call) => !call[2]?.method);
  const writes = (json: ReturnType<typeof setup>['json']) =>
    json.mock.calls.filter((call) => call[2]?.method);

  it('gives the write a longer deadline and a full-request response cap', async () => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json').mockResolvedValue({
      response_status: { status_code: 2000 },
      request: { id: '123' },
    });
    await submitMutation(provider, 'token', signal, update);
    expect(json.mock.calls[0]![3]).toBe(1048576);
    expect(json.mock.calls[0]![4]).toBe(60000);
  });
  it('confirms a timed-out write once a single re-read shows the requested values', async () => {
    const { provider, json, warn } = setup(new SdpProviderError('outage'), () => ({
      request: { id: '123', display_id: '42', status: { name: 'Closed' }, group: { name: 'NOC' } },
    }));
    await expect(submitMutation(provider, 'token', signal, update)).resolves.toEqual({
      id: '123',
      number: '42',
      kind: 'update',
    });
    expect(writes(json)).toHaveLength(1);
    expect(reads(json).map((call) => call[0])).toEqual([expect.stringMatching(/\/requests\/123$/)]);
    expect(warn).toHaveBeenCalledWith('SDP change failed', {
      mutation: 'update',
      kind: 'outage',
      diagnostic: undefined,
      status: undefined,
      verified: 'applied',
    });
  });
  it('reports a definite failure when the re-read still shows the earlier values', async () => {
    const { provider, json, warn } = setup(
      new SdpProviderError('invalid', 0, 'response-size'),
      () => ({ request: { id: '123', status: { name: 'Open' }, group: { name: 'NOC' } } }),
    );
    await expect(submitMutation(provider, 'token', signal, update)).rejects.toBeInstanceOf(
      SdpChangeNotAppliedError,
    );
    await expect(submitMutation(provider, 'token', signal, update)).rejects.toThrow(
      'SDP did not apply the change',
    );
    expect(writes(json)).toHaveLength(2);
    expect(reads(json)).toHaveLength(2);
    // Diagnostics name the failure kind only, never ticket IDs or values.
    expect(warn).toHaveBeenCalledWith('SDP change failed', {
      mutation: 'update',
      kind: 'invalid',
      diagnostic: 'response-size',
      status: undefined,
      verified: 'not-applied',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/123|Closed|NOC|Open/);
  });
  it('compares cleared references, request types, subjects and stored HTML', async () => {
    const fields = {
      subject: 'Printer down',
      description: 'a<b',
      resolution: 'Fixed',
      requestType: 'Incident',
      technician: null,
    };
    const fresh = {
      id: '123',
      subject: 'Printer down',
      description: 'a&lt;b',
      resolution: { content: 'Fixed' },
      request_type: { name: 'Incident' },
      technician: null,
    };
    let current: Record<string, unknown> = fresh;
    const { provider } = setup(new SdpProviderError('throttled'), () => ({ request: current }));
    const mutation = SdpMutationSchema.parse({ kind: 'update', id: '123', fields });
    await expect(submitMutation(provider, 'token', signal, mutation)).resolves.toMatchObject({
      id: '123',
    });
    current = { ...fresh, technician: { name: 'Someone' } };
    await expect(submitMutation(provider, 'token', signal, mutation)).rejects.toBeInstanceOf(
      SdpChangeNotAppliedError,
    );
    // SDP may normalize stored HTML, so a differing description stays unconfirmed.
    current = { ...fresh, description: '<div>a&lt;b</div>' };
    await expect(submitMutation(provider, 'token', signal, mutation)).rejects.toThrow(
      'SDP did not confirm the change',
    );
  });
  it('keeps the uncertain result when the re-read also fails', async () => {
    const { provider, json } = setup(new SdpProviderError('outage'), () => {
      throw new SdpProviderError('outage');
    });
    await expect(submitMutation(provider, 'token', signal, update)).rejects.toThrow(
      'SDP did not confirm the change',
    );
    expect(writes(json)).toHaveLength(1);
    expect(reads(json)).toHaveLength(1);
  });
  it('rethrows denial and validation failures without a verification read', async () => {
    for (const failure of [
      new SdpProviderError('denied', 0, 'http', 403),
      new SdpValidationError([]),
    ]) {
      const { provider, json } = setup(failure, () => ({ request: { id: '123' } }));
      await expect(submitMutation(provider, 'token', signal, update)).rejects.toBe(failure);
      expect(reads(json)).toHaveLength(0);
      expect(writes(json)).toHaveLength(1);
    }
  });
  it('does not verify kinds without an exact field comparison', async () => {
    const { provider, json } = setup(new SdpProviderError('outage'), () => ({
      request: { id: '123' },
    }));
    await expect(
      submitMutation(provider, 'token', signal, {
        kind: 'note',
        id: '123',
        body: 'Internal',
        showToRequester: false,
      }),
    ).rejects.toThrow('SDP did not confirm the change');
    expect(reads(json)).toHaveLength(0);
  });
});
