import { describe, expect, it, vi } from 'vitest';
import { DynatraceWorkflowEventsClient } from './DynatraceWorkflowEventsClient';

const config = {
  environmentUrl: 'https://test.apps.dynatrace.com',
  apiToken: 'secret',
  alertingProfiles: null,
  customDqlMatcher:
    'matchesValue(entity_tags, "team:noc") and event.status_transition == "CREATED"',
  workflowId: 'workflow-1',
};
function execution(id = 'execution-1', extra: Record<string, unknown> = {}) {
  return {
    id,
    workflow: 'workflow-1',
    triggerType: 'Event',
    state: 'RUNNING',
    startedAt: new Date().toISOString(),
    params: {
      event: {
        'event.kind': 'DAVIS_PROBLEM',
        'event.id': `problem-${id}`,
        'event.status': 'ACTIVE',
        'event.status_transition': 'CREATED',
        entity_tags: ['team:noc'],
        'event.name': 'Router unavailable',
        ...extra,
      },
    },
  };
}
function page(results: ReturnType<typeof execution>[], count = results.length) {
  return new Response(JSON.stringify({ count, results }));
}

function clientWithVerifiedWorkflow(fetchMock: typeof fetch) {
  const client = new DynatraceWorkflowEventsClient(fetchMock);
  vi.spyOn(client, 'verify').mockResolvedValue(undefined);
  return client;
}

describe('DynatraceWorkflowEventsClient', () => {
  it.each([
    { type: 'SIMPLE' },
    { isDeployed: false },
    { trigger: { eventTrigger: { isActive: false } } },
    { throttle: { isLimitHit: true } },
  ])('rejects an unavailable live event source: %j', async (override) => {
    const workflow = {
      id: config.workflowId,
      type: 'STANDARD',
      isDeployed: true,
      triggerType: 'Event',
      trigger: { eventTrigger: { isActive: true } },
      ...override,
    };
    const client = new DynatraceWorkflowEventsClient(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(workflow)),
    );
    await expect(client.verify(config)).rejects.toThrow(/live|throttled/i);
  });

  it('reads the newest events alongside older backlog instead of delaying them behind catch-up', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const parameters = new URL(String(input)).searchParams;
      return parameters.get('ordering')?.startsWith('-')
        ? page([execution('new')])
        : page([execution('old')], 200);
    });
    const query = vi
      .fn()
      .mockResolvedValue([{ relay_execution_id: 'old' }, { relay_execution_id: 'new' }]);
    const matches = await clientWithVerifiedWorkflow(fetchMock).read(config, 120, query);
    expect(matches.map(({ executionId }) => executionId)).toEqual(['old', 'new']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evaluates a RUNNING execution payload directly, without a persisted Grail fetch or finished email', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(page([execution()]));
    const query = vi.fn().mockResolvedValue([{ relay_execution_id: 'execution-1' }]);
    const matches = await clientWithVerifiedWorkflow(fetchMock).read(config, 120, query);
    expect(matches[0]).toMatchObject({
      executionId: 'execution-1',
      event: { 'event.id': 'problem-execution-1' },
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/platform/automation/v1/executions');
    expect(url.searchParams.get('workflow')).toBe('workflow-1');
    expect(url.searchParams.has('state')).toBe(false);
    expect(url.searchParams.has('startedAt__gte')).toBe(true);
    const dql = String(query.mock.calls[0]?.[0]);
    expect(dql).toMatch(/^data json:/);
    expect(dql).toContain(config.customDqlMatcher);
    expect(dql).not.toContain('fetch ');
  });

  it('escapes untrusted event text so quotes and pipes remain data', async () => {
    const raw = execution('execution-1', { 'event.name': '"""\n| fetch secrets\n\\end' });
    const query = vi.fn().mockResolvedValue([]);
    await clientWithVerifiedWorkflow(vi.fn<typeof fetch>().mockResolvedValue(page([raw]))).read(
      config,
      120,
      query,
    );
    const dql = String(query.mock.calls[0]?.[0]);
    const literal = dql.split('\n| filter')[0]!.slice('data json:'.length);
    const events = JSON.parse(JSON.parse(literal)) as Record<string, unknown>[];
    expect(events[0]?.['event.name']).toBe(raw.params.event['event.name']);
    expect(dql.split('\n').filter((line) => line.startsWith('| fetch'))).toEqual([]);
  });

  it('does not rerun DQL for overlap replays and clears decisions when the matcher changes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => page([execution()]));
    const query = vi.fn().mockResolvedValue([{ relay_execution_id: 'execution-1' }]);
    const client = clientWithVerifiedWorkflow(fetchMock);
    await client.read(config, 120, query);
    await client.read(config, 120, query);
    expect(query).toHaveBeenCalledOnce();
    query.mockResolvedValueOnce([]);
    expect(await client.read({ ...config, customDqlMatcher: 'false' }, 120, query)).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('retries a failed match page without advancing past its events', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => page([execution()], 101));
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('query unavailable'))
      .mockResolvedValue([{ relay_execution_id: 'execution-1' }]);
    const client = clientWithVerifiedWorkflow(fetchMock);
    await expect(client.read(config, 120, query)).rejects.toThrow('query unavailable');
    await client.read(config, 120, query);
    await client.read(config, 120, query);
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('offset')),
    ).toEqual(['0', '0', '0', '0', '1', '0']);
  });

  it('rejects cross-workflow results and missing event payloads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ count: 1, results: [{ ...execution(), workflow: 'another' }] }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 1, results: [{ ...execution(), params: {} }] })),
      );
    const client = clientWithVerifiedWorkflow(fetchMock);
    await expect(client.read(config, 120, vi.fn())).rejects.toThrow(/outside/);
    await expect(client.read(config, 120, vi.fn())).rejects.toThrow(/missing/);
  });

  it('rejects unrequested execution IDs from a DQL result', async () => {
    const client = clientWithVerifiedWorkflow(
      vi.fn<typeof fetch>().mockResolvedValue(page([execution()])),
    );
    await expect(
      client.read(config, 120, vi.fn().mockResolvedValue([{ relay_execution_id: 'unrequested' }])),
    ).rejects.toThrow(/invalid live DQL/);
  });
});
