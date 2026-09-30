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
    const literal = dql.split('\n')[0]!.slice('data json:'.length);
    const events = JSON.parse(JSON.parse(literal)) as Record<string, unknown>[];
    expect((events[0]?.relay_trigger_payload as Record<string, unknown>)?.['event.name']).toBe(
      raw.params.event['event.name'],
    );
    expect(dql.split('\n').filter((line) => line.startsWith('| fetch'))).toEqual([]);
  });

  it('preserves reserved metadata and nested values without changing the matcher', async () => {
    const event = execution('execution-1', {
      'dt.system.bucket': 'default_davis_problems',
      'dt.system.routing_key': 'default',
      relay_trigger_payload: 'original value',
      nested: { key: 'value' },
    });
    const matcher = 'dt.system.bucket == "default_davis_problems"';
    const query = vi.fn().mockResolvedValue([{ relay_execution_id: 'execution-1' }]);
    const result = await clientWithVerifiedWorkflow(
      vi.fn<typeof fetch>().mockResolvedValue(page([event])),
    ).read({ ...config, customDqlMatcher: matcher }, 120, query);
    const dql = String(query.mock.calls[0]?.[0]);
    const records = JSON.parse(JSON.parse(dql.split('\n')[0]!.slice('data json:'.length)));
    expect(records).toEqual([
      {
        relay_trigger_payload_: {
          ...event.params.event,
          relay_execution_id: 'execution-1',
        },
      },
    ]);
    expect(dql).toContain('| fieldsFlatten relay_trigger_payload_, prefix: ""');
    expect(dql).toContain('| fieldsRemove relay_trigger_payload_\n| filter (\n' + matcher);
    expect(result[0]?.event).toEqual(event.params.event);
  });

  it('finishes each large event batch before evaluating the next one', async () => {
    const ids = Array.from({ length: 9 }, (_, index) => `event-${index}`);
    const events = ids.map((id) => execution(id, { 'event.name': 'x'.repeat(60 * 1024) }));
    let release!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let peak = 0;
    let batches = 0;
    const query = vi.fn(async (dql: string) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        batches += 1;
        if (batches === 1) await firstBatch;
        const records = JSON.parse(
          JSON.parse(dql.split('\n')[0]!.slice('data json:'.length)),
        ) as Array<{ relay_trigger_payload: { relay_execution_id: string } }>;
        return records.map((record) => ({
          relay_execution_id: record.relay_trigger_payload.relay_execution_id,
        }));
      } finally {
        active -= 1;
      }
    });
    const reading = clientWithVerifiedWorkflow(
      vi.fn<typeof fetch>().mockImplementation(async () => page(events)),
    ).read(config, 120, query);
    try {
      await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
      release();
      const matched = await reading;
      expect(matched.map(({ executionId }) => executionId)).toEqual(ids);
      expect(query).toHaveBeenCalledTimes(3);
      expect(peak).toBe(1);
    } finally {
      release();
      await reading;
    }
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

// Endpoint tests isolate authentication; OAuthIntegration covers the full exchange and transport path.
vi.mock('./DynatraceAuthentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DynatraceAuthentication')>();
  const authentication = new actual.DynatraceAuthentication();
  authentication.token = vi.fn(async (config) => config.apiToken);
  return { ...actual, dynatraceAuthentication: () => authentication };
});

describe('following workflow task DQL', () => {
  const workflow = (matcher: string) =>
    new Response(
      JSON.stringify({
        id: config.workflowId,
        type: 'STANDARD',
        isDeployed: true,
        triggerType: 'Event',
        trigger: { eventTrigger: { isActive: true } },
        tasks: {
          noc: {
            action: 'dynatrace.automations:execute-dql-query',
            input: { query: `fetch events | filter ${matcher}` },
          },
        },
      }),
    );
  it('reuses verification reads, notices edits after one minute, and reevaluates cached events', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    try {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(workflow('event.name == "old"'))
        .mockResolvedValueOnce(page([execution()]))
        .mockResolvedValueOnce(workflow('event.name == "new"'))
        .mockResolvedValueOnce(page([execution()]));
      const client = new DynatraceWorkflowEventsClient(transport);
      const initial = await client.resolveDql({ ...config, workflowDqlTask: '' });
      const query = vi.fn().mockResolvedValue([{ relay_execution_id: 'execution-1' }]);
      await client.read(initial, 120, query);
      await client.resolveDql(initial);
      expect(transport).toHaveBeenCalledTimes(2);
      clock.mockReturnValue(161_000);
      const updated = await client.resolveDql(initial);
      expect(updated.customDqlMatcher).toBe('event.name == "new"');
      await client.read(updated, 120, query);
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1]?.[0]).toContain('event.name == "new"');
      expect(transport).toHaveBeenCalledTimes(4);
      expect(transport.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
        true,
      );
    } finally {
      clock.mockRestore();
    }
  });
  it('never imports another environment’s task when settings reads overlap', async () => {
    const first = { ...config, workflowDqlTask: '' };
    const second = { ...first, environmentUrl: 'https://other.apps.dynatrace.com' };
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        workflow(
          String(url).includes('other.apps') ? 'event.name == "other"' : 'event.name == "first"',
        ),
      );
    const client = new DynatraceWorkflowEventsClient(transport);
    const results = await Promise.allSettled([client.resolveDql(first), client.resolveDql(second)]);
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled')
        expect(result.value.customDqlMatcher).toBe(
          index === 0 ? 'event.name == "first"' : 'event.name == "other"',
        );
      else expect(String(result.reason)).toContain('source changed');
    }
  });

  it('coalesces concurrent definition reads and rejects a removed task without replacing it', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(workflow('event.name == "old"'));
    const client = new DynatraceWorkflowEventsClient(transport);
    await Promise.all([
      client.resolveDql({ ...config, workflowDqlTask: '' }),
      client.resolveDql({ ...config, workflowDqlTask: '' }),
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(client.resolveDql({ ...config, workflowDqlTask: 'deleted' })).rejects.toThrow(
      'missing or inactive',
    );
    expect(config.customDqlMatcher).toContain('team:noc');
  });
});
