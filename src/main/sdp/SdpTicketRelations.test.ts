import { expect, it, vi } from 'vitest';
import { SdpProvider } from './SdpProvider';
import { readTicketRelations } from './SdpTicketRelations';
import { mutationBaseline, submitMutation } from './SdpMutations';
import { SdpMutationSchema } from '@shared/sdpMutation';
import { SdpBrokerReplySchema } from '@shared/sdpAccount';
const signal = new AbortController().signal;
function setup() {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockImplementation(async (url, _signal, init) => {
    if (init?.method) return { response_status: { status_code: 2000 } };
    const path = new URL(url).pathname;
    if (path.endsWith('/_links'))
      return {
        _links: [
          { name: 'link_requests', method: 'get' },
          { name: 'link_requests', method: 'post' },
          { name: 'link_requests', method: 'delete' },
          { name: 'merge_requests', method: 'put' },
        ],
      };
    if (path.endsWith('/_link_requests'))
      return {
        link_requests: [{ linked_request: { id: '456', display_id: '2', subject: 'Duplicate' } }],
        list_info: { has_more_rows: false },
      };
    if (path.endsWith('/requests'))
      return { requests: [{ id: '456', display_id: '2', subject: 'Duplicate' }] };
    return { request: { id: path.split('/').at(-1), subject: 'Example' } };
  });
  return { provider, json };
}
it.each(['link', 'unlink', 'merge'] as const)(
  'uses the verified Cloud %s payload after checking permissions and the target',
  async (operation) => {
    const { provider, json } = setup();
    await submitMutation(provider, 'token', signal, {
      kind: 'relation',
      id: '123',
      targetId: '456',
      operation,
    });
    const [url, , init] = json.mock.lastCall!;
    expect(url).toBe(
      `https://support.campingworld.com/app/itdesk/api/v3/requests/123/_${operation === 'merge' ? 'merge_requests' : 'link_requests'}`,
    );
    expect(init?.method).toBe({ link: 'POST', unlink: 'DELETE', merge: 'PUT' }[operation]);
    const input = JSON.parse(new URLSearchParams(init?.body as string).get('input_data')!);
    expect(input).toEqual(
      operation === 'merge'
        ? { merge_requests: [{ id: '456' }] }
        : { link_requests: [{ linked_request: { id: '456' } }] },
    );
    expect(json.mock.calls.some(([u]) => u.endsWith('/456'))).toBe(true);
  },
);
it('projects links and searches by ticket number through the strict gateway schema', async () => {
  const { provider, json } = setup();
  const ticketRelations = await readTicketRelations(provider, 'token', signal, {
    action: 'readTicketRelations',
    id: '123',
    number: 'IN-2',
    page: 0,
  });
  expect(ticketRelations.candidate).toEqual({ id: '456', number: '2', subject: 'Duplicate' });
  expect(ticketRelations.linked).toHaveLength(1);
  expect(json.mock.calls.find(([url]) => url.includes('_link_requests'))?.[0]).not.toContain('?');
  const input = JSON.parse(new URL(json.mock.lastCall![0]).searchParams.get('input_data')!);
  expect(input.list_info.search_criteria).toEqual({
    field: 'display_id',
    condition: 'is',
    value: '2',
  });
  expect(
    SdpBrokerReplySchema.safeParse({
      view: { configured: true, status: 'connected', ticketRelations },
    }).success,
  ).toBe(true);
});
it('rejects self-merges, unauthorized operations, and detects target changes in the baseline', async () => {
  const { provider, json } = setup();
  const mutation = { kind: 'relation', id: '123', targetId: '456', operation: 'merge' } as const;
  expect(SdpMutationSchema.safeParse({ ...mutation, targetId: '123' }).success).toBe(false);
  const before = await mutationBaseline(provider, 'token', signal, '123', mutation);
  const original = json.getMockImplementation()!;
  json.mockImplementation(async (...args) =>
    args[0].endsWith('/456') ? { request: { id: '456', subject: 'Changed' } } : original(...args),
  );
  expect(await mutationBaseline(provider, 'token', signal, '123', mutation)).not.toBe(before);
  json.mockResolvedValue({ _links: [] });
  await expect(submitMutation(provider, 'token', signal, mutation)).rejects.toMatchObject({
    kind: 'denied',
  });
  expect(json.mock.calls.some((c) => c[2]?.method)).toBe(false);
});
it('does not report an HTTP 200 partial close as success', async () => {
  const { provider, json } = setup();
  json.mockResolvedValue({
    response_status: { status_code: 3000, messages: [{ fields: ['category', 'subcategory'] }] },
  });
  await expect(
    submitMutation(provider, 'token', signal, {
      kind: 'update',
      id: '123',
      fields: { status: 'Closed' },
    }),
  ).rejects.toThrow('Check required fields: category, subcategory');
});
