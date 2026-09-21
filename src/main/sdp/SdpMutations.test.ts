import { describe, expect, it, vi } from 'vitest';
import { SdpProvider } from './SdpProvider';
import { submitMutation } from './SdpMutations';
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
