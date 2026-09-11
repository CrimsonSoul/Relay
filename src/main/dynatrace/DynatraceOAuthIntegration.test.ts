import { describe, expect, it, vi } from 'vitest';
import { DYNATRACE_OAUTH_SCOPES } from '@shared/dynatraceProblems';
import { DynatraceProblemsClient } from './DynatraceProblemsClient';

const config = {
  environmentUrl: 'https://test.apps.dynatrace.com',
  apiToken: '',
  oauth: {
    clientId: 'dt0s02.client',
    clientSecret: 'private-client-secret',
    accountUuid: '12345678-1234-1234-1234-123456789012',
  },
  workflowId: 'workflow-1',
  customDqlMatcher: 'matchesValue(entity_tags, "team:noc")',
  alertingProfiles: null,
};

function setup() {
  let exchanges = 0;
  const paths = new Set<string>();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === 'https://sso.dynatrace.com') {
      expect(url.pathname).toBe('/sso/oauth2/token');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_secret')).toBe(config.oauth.clientSecret);
      expect(body.get('scope')).toBe(DYNATRACE_OAUTH_SCOPES.join(' '));
      exchanges += 1;
      return Response.json({
        access_token: `oauth-access-${exchanges}`,
        token_type: 'Bearer',
        expires_in: 300,
      });
    }
    expect(url.origin).toBe(config.environmentUrl);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer oauth-access-${exchanges}` });
    expect(JSON.stringify(init)).not.toContain(config.oauth.clientSecret);
    expect(init?.redirect).toBe('error');
    paths.add(url.pathname);
    if (url.pathname.endsWith('/problems')) {
      if (url.searchParams.get('from') === '0')
        return Response.json(
          { error: { message: 'The property startTime must not be null or empty.' } },
          { status: 400 },
        );
      return Response.json({
        totalCount: 1,
        problems: [
          {
            problemId: 'matched',
            displayId: 'P-1',
            title: 'Canonical API title',
            status: 'OPEN',
            severityLevel: 'ERROR',
            impactLevel: 'SERVICES',
            startTime: Date.now() - 60_000,
            endTime: -1,
            affectedEntities: [],
            impactedEntities: [],
            managementZones: [],
            problemFilters: [],
          },
        ],
      });
    }
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
                'dt.system.bucket': 'test_problems',
                'dt.system.routing_key': 'test',
                'event.kind': 'DAVIS_PROBLEM',
                'event.id': 'matched',
                'event.status': 'ACTIVE',
                'event.name': 'NOC title',
                entity_tags: ['team:noc'],
              },
            },
          },
        ],
      });
    if (url.pathname.endsWith('query:execute')) {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      const records = JSON.parse(
        JSON.parse(query.split('\n')[0]!.slice('data json:'.length)),
      ) as Record<string, unknown>[];
      expect(records[0]).not.toHaveProperty('dt.system.bucket');
      expect(records[0]?.relay_trigger_payload).toMatchObject({
        'dt.system.bucket': 'test_problems',
        'dt.system.routing_key': 'test',
      });
      expect(query).toContain('| fieldsFlatten relay_trigger_payload, prefix: ""');
      expect(query).not.toContain('depth:');
      return Response.json({
        state: 'SUCCEEDED',
        result: { records: [{ relay_execution_id: 'execution-1' }] },
      });
    }
    if (url.pathname.endsWith('/tasks'))
      return Response.json({ email: { action: 'dynatrace.email:send-email', state: 'SUCCESS' } });
    if (url.pathname.endsWith('/input')) return Response.json({ subject: 'NOC email subject' });
    throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
  });
  return {
    client: new DynatraceProblemsClient(fetchMock),
    fetchMock,
    paths,
    exchanges: () => exchanges,
  };
}

describe('OAuth across the Dynatrace integration', () => {
  it('shares one exchange across live API, workflow events, native DQL, and email title reads', async () => {
    const { client, paths, exchanges } = setup();
    await expect(client.testConnection(config)).resolves.toBe(1);
    const live = await client.fetchLiveProblems(config, {
      mode: 'incremental',
      lookbackMinutes: 120,
    });
    expect(live.scopeError).toBeUndefined();
    expect(live.problems).toHaveLength(1);
    expect(live.problems[0]).toMatchObject({ problemId: 'matched', status: 'OPEN' });
    const names = await client.fetchNotificationTitles(config);
    expect(names.titles).toEqual([
      expect.objectContaining({ notificationTitle: 'NOC email subject' }),
    ]);
    expect(exchanges()).toBe(1);
    expect(paths).toEqual(
      new Set([
        '/platform/classic/environment-api/v2/problems',
        '/platform/automation/v1/workflows/workflow-1',
        '/platform/automation/v1/executions',
        '/platform/storage/query/v1/query:execute',
        '/platform/automation/v1/executions/execution-1/tasks',
        '/platform/automation/v1/executions/execution-1/tasks/email/input',
      ]),
    );
  });

  it('does not send legacy platform tokens to any Dynatrace endpoint', async () => {
    const { client, fetchMock } = setup();
    const legacy = { ...config, oauth: undefined, apiToken: 'dt0s16.legacy' };
    await expect(client.testConnection(legacy)).rejects.toThrow(/requires OAuth setup/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('obtains a new access token after an API rejects a cached token with 401', async () => {
    let exchanges = 0;
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes('sso.dynatrace.com')) {
        exchanges += 1;
        return Response.json({
          access_token: `access-${exchanges}`,
          token_type: 'Bearer',
          expires_in: 300,
        });
      }
      reads += 1;
      return reads === 1
        ? new Response('', { status: 401 })
        : Response.json({ totalCount: 0, problems: [] });
    });
    const client = new DynatraceProblemsClient(fetchMock);
    await expect(client.testConnection(config)).rejects.toThrow(/401/);
    await expect(client.testConnection(config)).resolves.toBe(0);
    expect(exchanges).toBe(2);
  });
});
