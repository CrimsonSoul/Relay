import { describe, expect, it, vi } from 'vitest';
import { SdpResourceMutationSchema } from '@shared/sdpResources';
import { readResources, resourceInput, resourcePath } from './SdpResources';
import { SdpProvider } from './SdpProvider';
import { mutationBaseline, submitMutation } from './SdpMutations';
const signal = new AbortController().signal;
describe('native SDP request work', () => {
  it('validates routes, operation compatibility and input fields', () => {
    const value = {
      kind: 'resource',
      id: '123',
      resource: 'tasks',
      operation: 'create',
      fields: { title: 'Investigate' },
    };
    expect(SdpResourceMutationSchema.safeParse(value).success).toBe(true);
    for (const patch of [
      { id: '../admin' },
      { resource: 'users' },
      { operation: 'approve' },
      { operation: 'delete' },
      { fields: { title: 'Valid', unknown: 'value' } },
      { fields: { title: 'Valid', completion: '101' } },
      { fields: { title: 'Valid', ownerEmail: 'not-email' } },
    ])
      expect(SdpResourceMutationSchema.safeParse({ ...value, ...patch }).success).toBe(false);
    expect(resourcePath({ id: '123', resource: 'approvals', levelId: '4', recordId: '9' })).toBe(
      'https://support.campingworld.com/app/itdesk/api/v3/requests/123/approval_levels/4/approvals/9',
    );
  });
  it('encodes task text, names and dates and keeps worklogs from changing first-response state', () => {
    const task = SdpResourceMutationSchema.parse({
      kind: 'resource',
      id: '123',
      resource: 'tasks',
      operation: 'create',
      fields: {
        title: 'Investigate',
        description: '<script>test</script>',
        ownerEmail: 'user@example.test',
        status: 'Open',
        scheduledStart: '2026-09-17T10:00:00Z',
      },
    });
    expect(resourceInput(task)).toEqual({
      task: {
        title: 'Investigate',
        description: '&lt;script&gt;test&lt;/script&gt;',
        owner: { email_id: 'user@example.test' },
        status: { name: 'Open' },
        scheduled_start_time: { value: String(Date.parse('2026-09-17T10:00:00Z')) },
      },
    });
    const worklog = SdpResourceMutationSchema.parse({
      kind: 'resource',
      id: '123',
      resource: 'worklogs',
      operation: 'create',
      fields: { ownerEmail: 'user@example.test', hours: '1', minutes: '30' },
    });
    expect(resourceInput(worklog)).toEqual({
      worklog: {
        owner: { email_id: 'user@example.test' },
        time_spent: { hours: '1', minutes: '30' },
        mark_first_response: false,
      },
    });
  });
  it('projects only supported fields and paginates within the selected request', async () => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json').mockResolvedValue({
      tasks: [
        {
          id: '4',
          title: 'Review',
          status: { name: 'Open' },
          owner: { email_id: 'user@example.test', private_profile: 'omit' },
          unknown: 'omit',
        },
      ],
      list_info: { has_more_rows: true },
    });
    const page = await readResources(provider, 'token', signal, {
      action: 'readResources',
      id: '123',
      resource: 'tasks',
      page: 1,
    });
    expect(page).toMatchObject({
      page: 1,
      hasMore: true,
      rows: [
        {
          id: '4',
          title: 'Review',
          fields: { title: 'Review', status: 'Open', ownerEmail: 'user@example.test' },
        },
      ],
    });
    expect(page.rows[0]?.fields.scheduledStart).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain('omit');
    expect(new URL(json.mock.calls[0]![0]).searchParams.get('input_data')).toContain('51');
  });
  it('includes child-record changes in the review conflict check', async () => {
    const provider = new SdpProvider();
    const json = vi.spyOn(provider, 'json');
    const mutation = SdpResourceMutationSchema.parse({
      kind: 'resource',
      id: '123',
      resource: 'tasks',
      recordId: '4',
      operation: 'update',
      fields: { status: 'Closed' },
    });
    json
      .mockResolvedValueOnce({ request: { id: '123' } })
      .mockResolvedValueOnce({ task: { id: '4', title: 'Before' } });
    const before = await mutationBaseline(provider, 'token', signal, '123', mutation);
    json
      .mockResolvedValueOnce({ request: { id: '123' } })
      .mockResolvedValueOnce({ task: { id: '4', title: 'After' } });
    expect(await mutationBaseline(provider, 'token', signal, '123', mutation)).not.toBe(before);
  });
  it.each(['approve', 'reject', 'delete'] as const)(
    'uses the documented %s endpoint once',
    async (operation) => {
      const provider = new SdpProvider();
      const json = vi
        .spyOn(provider, 'json')
        .mockResolvedValue({ response_status: { status_code: 2000 } });
      const mutation = SdpResourceMutationSchema.parse({
        kind: 'resource',
        id: '123',
        resource: 'approvals',
        levelId: '4',
        recordId: '9',
        operation,
        fields: operation === 'delete' ? {} : { comments: 'Reviewed' },
      });
      expect(await submitMutation(provider, 'token', signal, mutation)).toMatchObject({
        id: '123',
        kind: 'resource',
      });
      expect(json).toHaveBeenCalledTimes(1);
      expect(json.mock.calls[0]![0]).toBe(
        resourcePath(mutation) + (operation === 'delete' ? '' : `/_${operation}`),
      );
      expect(json.mock.calls[0]![2]?.method).toBe(operation === 'delete' ? 'DELETE' : 'PUT');
    },
  );
});
