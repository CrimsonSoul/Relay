import { describe, expect, it, vi } from 'vitest';
import { DynatraceProblemsClient } from './DynatraceProblemsClient';

const config = {
  environmentUrl: 'https://test.apps.dynatrace.com',
  apiToken: 'secret',
  workflowId: 'workflow-1',
  customDqlMatcher: 'matchesValue(entity_tags, "team:noc")',
  alertingProfiles: null,
};
function problem(problemId: string) {
  return {
    problemId,
    displayId: 'P-1',
    title: 'Canonical',
    status: 'CLOSED',
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: Date.now() - 60000,
    endTime: Date.now(),
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
  };
}
function setup() {
  let failDql = false;
  const queries: string[] = [];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/classic/'))
      return Response.json({
        problems: url.searchParams.get('problemSelector')?.includes('closed')
          ? [problem('matched'), problem('outside')]
          : [],
      });
    if (url.pathname.endsWith('/workflows/workflow-1'))
      return Response.json({
        id: 'workflow-1',
        type: 'STANDARD',
        isDeployed: true,
        triggerType: 'Event',
        trigger: { eventTrigger: { isActive: true } },
      });
    if (url.pathname.endsWith('/executions'))
      return Response.json({
        count: 1,
        results: [
          {
            id: 'execution-1',
            workflow: 'workflow-1',
            triggerType: 'Event',
            startedAt: new Date().toISOString(),
            state: 'RUNNING',
            params: {
              event: {
                'event.kind': 'DAVIS_PROBLEM',
                'event.id': 'matched',
                'event.status': 'ACTIVE',
                'event.name': 'NOC name',
                entity_tags: ['team:noc'],
              },
            },
          },
        ],
      });
    if (url.pathname.endsWith('query:execute')) {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      queries.push(query);
      if (!query.startsWith('data json:'))
        throw new Error('Persisted Grail records are unavailable');
      if (failDql) return new Response('', { status: 429, headers: { 'retry-after': '90' } });
      return Response.json({
        state: 'SUCCEEDED',
        result: {
          records: query.includes('\nfalse\n') ? [] : [{ relay_execution_id: 'execution-1' }],
        },
      });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  });
  return {
    client: new DynatraceProblemsClient(fetchMock),
    fetchMock,
    queries,
    failDql: () => {
      failDql = true;
    },
  };
}

describe('Dynatrace live source composition', () => {
  it('admits a matching event before Grail persistence while retaining the API close state', async () => {
    const { client, queries } = setup();
    const result = await client.fetchLiveProblems(config, {
      mode: 'incremental',
      lookbackMinutes: 120,
    });
    expect(result.problems).toMatchObject([
      {
        problemId: 'matched',
        status: 'CLOSED',
        workflowTitle: 'NOC name',
        workflowTags: ['team:noc'],
      },
    ]);
    expect(result.changedProblems).toHaveLength(2);
    expect(result.scopeError).toBeUndefined();
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain('fetch ');
  });

  it('clears live eligibility when the expression changes', async () => {
    const { client } = setup();
    await client.fetchLiveProblems(config, { mode: 'incremental', lookbackMinutes: 120 });
    const result = await client.fetchLiveProblems(
      { ...config, customDqlMatcher: 'false' },
      { mode: 'incremental', lookbackMinutes: 120 },
    );
    expect(result.problems).toEqual([]);
  });

  it('continues returning API lifecycle updates and respects DQL Retry-After', async () => {
    const { client, queries, failDql } = setup();
    failDql();
    const first = await client.fetchLiveProblems(config, {
      mode: 'incremental',
      lookbackMinutes: 120,
    });
    const second = await client.fetchLiveProblems(config, {
      mode: 'incremental',
      lookbackMinutes: 120,
    });
    expect(first.problems).toEqual([]);
    expect(second.changedProblems).toHaveLength(2);
    expect(second.scopeError).toMatch(/rate-limited/i);
    expect(queries).toHaveLength(1);
  });
});

// Endpoint tests isolate authentication; OAuthIntegration covers the full exchange and transport path.
vi.mock('./DynatraceAuthentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DynatraceAuthentication')>();
  const authentication = new actual.DynatraceAuthentication();
  authentication.token = vi.fn(async (config) => config.apiToken);
  return { ...actual, dynatraceAuthentication: () => authentication };
});
