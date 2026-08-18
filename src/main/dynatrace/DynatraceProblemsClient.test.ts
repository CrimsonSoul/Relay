import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { DynatraceProblemsClient, getDynatraceRetryAfterMs } from './DynatraceProblemsClient';

type FetchMock = Mock<typeof fetch>;

function fetchCall(mock: FetchMock, index: number): Parameters<typeof fetch> {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`Expected fetch to have been called at least ${index + 1} time(s).`);
  return call;
}

function fetchUrl(mock: FetchMock, index: number): string {
  return String(fetchCall(mock, index)[0]);
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

function fetchInit(mock: FetchMock, index: number): FetchInit {
  const init = fetchCall(mock, index)[1];
  if (!init) throw new Error(`Expected fetch call ${index + 1} to include request options.`);
  return init;
}

function authorizationHeader(mock: FetchMock, index: number): string | null {
  return new Headers(fetchInit(mock, index).headers).get('Authorization');
}

function requestBody(mock: FetchMock, index: number): Record<string, unknown> {
  const { body } = fetchInit(mock, index);
  if (typeof body !== 'string') {
    throw new Error(`Expected fetch call ${index + 1} to send a JSON string body.`);
  }
  const parsed: Record<string, unknown> = JSON.parse(body);
  return parsed;
}

function requestQuery(mock: FetchMock, index: number): string {
  const { query } = requestBody(mock, index);
  if (typeof query !== 'string') {
    throw new Error(`Expected fetch call ${index + 1} to send a DQL query string.`);
  }
  return query;
}

const config = {
  environmentUrl: 'https://abc123.apps.dynatrace.com',
  apiToken: 'dt0s16.platform-read-only-token',
  alertingProfiles: null,
  customDqlMatcher: null,
};

function problem(overrides: Record<string, unknown> = {}) {
  return {
    problemId: 'problem-1',
    displayId: 'P-240791',
    title: 'Payment service response time degradation',
    status: 'ACTIVE',
    severity: 'SLOWDOWN',
    impactLevel: 'Services',
    startTime: '2026-07-09T20:00:00.000Z',
    endTime: null,
    rootCause: { id: 'SERVICE-1', type: 'service', name: 'payments-api' },
    affectedEntities: [{ id: 'SERVICE-1', type: 'service', name: 'SERVICE-1' }],
    affectedEntityIds: ['SERVICE-1'],
    affectedEntityNames: ['payments-api'],
    affectedEntityTypes: ['SERVICE'],
    relatedEntities: [{ id: 'HOST-1', type: 'host', name: 'payments-host' }],
    alertingProfiles: ['Payments Production'],
    ...overrides,
  };
}

function queryResponse(
  records: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): Response {
  return response({
    state: 'SUCCEEDED',
    requestToken: 'query-token',
    result: { records },
    ...overrides,
  });
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DynatraceProblemsClient', () => {
  it('reconciles one year of Grail problems and maps the latest platform state into Relay records', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ state: 'SUCCEEDED', requestToken: 'query-token', progress: 100, result: null }),
      )
      .mockResolvedValueOnce(
        queryResponse([
          problem(),
          problem({
            problemId: 'problem-2',
            displayId: 'P-240792',
            status: 'CLOSED',
            severity: 'AVAILABILITY',
            impactLevel: ['Infrastructure'],
            endTime: '1783630800000000000',
            rootCause: null,
            rootCauseEntityName: 'checkout-host-02',
          }),
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems(config);

    expect(result.problems).toHaveLength(2);
    expect(result.resultTruncated).toBe(false);
    expect(result.problems[0]).toMatchObject({
      problemId: 'problem-1',
      displayId: 'P-240791',
      status: 'OPEN',
      severity: 'PERFORMANCE',
      impactLevel: 'SERVICES',
      rootCauseName: 'payments-api',
      environmentUrl: config.environmentUrl,
      affectedEntities: [{ id: 'SERVICE-1', type: 'service', name: 'payments-api' }],
      impactedEntities: [{ id: 'HOST-1', type: 'host', name: 'payments-host' }],
      alertingProfiles: ['Payments Production'],
    });
    expect(result.problems[1]).toMatchObject({
      problemId: 'problem-2',
      status: 'CLOSED',
      severity: 'AVAILABILITY',
      impactLevel: 'INFRASTRUCTURE',
      endTime: 1_783_630_800_000,
      rootCauseName: 'checkout-host-02',
    });

    expect(fetchUrl(fetchMock, 0)).toBe(
      'https://abc123.apps.dynatrace.com/platform/storage/query/v1/query:execute',
    );
    expect(authorizationHeader(fetchMock, 0)).toBe('Bearer dt0s16.platform-read-only-token');
    expect(requestBody(fetchMock, 0)).toMatchObject({
      query: expect.stringContaining('fetch dt.davis.problems, from:-365d'),
      requestTimeoutMilliseconds: 12_000,
      maxResultRecords: 10_000,
    });
    expect(requestQuery(fetchMock, 0)).toContain('smartscape.affected_entities');
    expect(requestQuery(fetchMock, 0)).toContain('labels.alerting_profile');
    expect(requestQuery(fetchMock, 0)).toContain('dedup event.id, sort:{timestamp desc}');
    expect(fetchUrl(fetchMock, 1)).toContain(
      '/platform/storage/query/v1/query:poll?request-token=query-token',
    );
  });

  it('uses a bounded change window for incremental polls', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(queryResponse([problem()]));
    const client = new DynatraceProblemsClient(fetchMock);

    await client.fetchProblems(config, { mode: 'incremental', lookbackMinutes: 12 });

    const query = requestQuery(fetchMock, 0);
    expect(query).toContain('fetch dt.davis.problems, from:-12m');
    expect(query).not.toContain('from:-365d');
    expect(query.indexOf('dedup event.id')).toBeLessThan(query.indexOf('filter not'));
  });

  it('polls an asynchronous Grail query and returns the test count', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ state: 'RUNNING', requestToken: 'request + token', progress: 25 }),
      )
      .mockResolvedValueOnce(queryResponse([{ problemCount: '7' }]));
    const client = new DynatraceProblemsClient(fetchMock);

    const pending = client.testConnection(config);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(7);
    expect(fetchUrl(fetchMock, 1)).toBe(
      'https://abc123.apps.dynatrace.com/platform/storage/query/v1/query:poll?request-token=request+%2B+token',
    );
    expect(authorizationHeader(fetchMock, 1)).toBe('Bearer dt0s16.platform-read-only-token');
  });

  it('keeps polling with the original token when later responses omit it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ state: 'RUNNING', requestToken: 'stable-token' }))
      .mockResolvedValueOnce(response({ state: 'RUNNING', progress: 75 }))
      .mockResolvedValueOnce(
        response({ state: 'SUCCEEDED', result: { records: [{ problemCount: 4 }] } }),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    const pending = client.testConnection(config);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(4);
    expect(fetchUrl(fetchMock, 1)).toContain('request-token=stable-token');
    expect(fetchUrl(fetchMock, 2)).toContain('request-token=stable-token');
  });

  it('filters the Grail query to any selected alerting profile with escaped literals', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        queryResponse([
          problem({ alertingProfiles: ['POS Store'], problemId: 'problem-filtered' }),
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    await client.fetchProblems({
      ...config,
      alertingProfiles: ['POS Store', 'NOC "Primary"'],
    });

    const query = requestQuery(fetchMock, 0);
    expect(query).toContain('iAny(in(labels.alerting_profile[]');
    expect(query).toContain('array("POS Store", "NOC \\"Primary\\"")');
  });

  it('combines alerting profiles and a custom matcher before Relay-owned projection', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(queryResponse([problem()]));
    const client = new DynatraceProblemsClient(fetchMock);

    await client.fetchProblems({
      ...config,
      alertingProfiles: ['Alerts for NOC'],
      customDqlMatcher: `matchesValue(entity_tags, "teams:network")
and maintenance.is_under_maintenance == false`,
    });

    const query = requestQuery(fetchMock, 0);
    const profileFilterAt = query.indexOf('iAny(in(labels.alerting_profile[]');
    const matcherAt = query.indexOf('matchesValue(entity_tags, "teams:network")');
    const fieldsAt = query.indexOf('| fields problemId=event.id');
    expect(profileFilterAt).toBeGreaterThan(-1);
    expect(matcherAt).toBeGreaterThan(profileFilterAt);
    expect(fieldsAt).toBeGreaterThan(matcherAt);
  });

  it('counts zero current matches with the same canonical custom scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(queryResponse([{ problemCount: 0 }]));
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(
      client.countMatchingProblems({
        ...config,
        customDqlMatcher: 'matchesPhrase(event.name, "No current match")',
      }),
    ).resolves.toBe(0);

    const query = requestQuery(fetchMock, 0);
    expect(query).toContain('| filter (\nmatchesPhrase(event.name, "No current match")\n)');
    expect(query).toContain('| summarize problemCount=count()');
    expect(query).not.toContain('| fields problemId=event.id');
  });

  it('observes unscoped changed IDs during incremental custom-filter polling', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse([problem()]))
      .mockResolvedValueOnce(
        queryResponse([{ problemId: 'problem-1' }, { problemId: 'problem-no-longer-matches' }]),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems(
      {
        ...config,
        customDqlMatcher: 'dt.davis.mute.status == "NOT_MUTED"',
      },
      { mode: 'incremental', lookbackMinutes: 12 },
    );

    expect(result.observedProblemIds).toEqual(['problem-1', 'problem-no-longer-matches']);
    expect(requestQuery(fetchMock, 0)).toContain('dt.davis.mute.status == "NOT_MUTED"');
    expect(requestQuery(fetchMock, 1)).toContain('| fields problemId=event.id');
    expect(requestQuery(fetchMock, 1)).not.toContain('dt.davis.mute.status');
  });

  it('defensively rejects unsafe matcher content before sending a Grail request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(
      client.countMatchingProblems({
        ...config,
        customDqlMatcher: 'matchesValue(event.name, "*") | limit 1',
      }),
    ).rejects.toThrow(/matcher expression/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads a distinct sorted alerting profile catalog without storing problem records', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        queryResponse([
          { alertingProfile: 'POS Store' },
          { alertingProfile: 'Alerts for NOC' },
          { alertingProfile: 'POS Store' },
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(client.fetchAlertingProfiles(config)).resolves.toEqual([
      'Alerts for NOC',
      'POS Store',
    ]);
    expect(requestQuery(fetchMock, 0)).toContain('expand alertingProfile=labels.alerting_profile');
  });

  it('checks whether alerting-profile metadata is still present before scoped reconciliation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      queryResponse([
        {
          problemCount: 42,
          profiledProblemCount: 39,
        },
      ]),
    );
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(client.inspectAlertingProfileField(config)).resolves.toEqual({
      problemCount: 42,
      profiledProblemCount: 39,
      healthy: true,
    });
    expect(requestQuery(fetchMock, 0)).toContain(
      'profiledProblemCount=countIf(isNotNull(labels.alerting_profile))',
    );
  });

  it('surfaces Grail result-limit warnings instead of treating a truncated response as complete', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      queryResponse([problem()], {
        result: {
          records: [problem()],
          metadata: {
            grail: {
              notifications: [
                {
                  notificationType: 'RESULT_RECORD_LIMIT_REACHED',
                  severity: 'WARN',
                  message: 'The maximum result record limit was reached.',
                },
              ],
            },
          },
        },
      }),
    );
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(client.fetchProblems(config)).resolves.toMatchObject({
      totalCount: 1,
      resultTruncated: true,
    });
  });

  it('treats an exact DQL limit-sized result as truncated even without a notification', async () => {
    const records = Array.from({ length: 10_000 }, (_, index) =>
      problem({ problemId: `problem-${index}`, displayId: `P-${index}` }),
    );
    const client = new DynatraceProblemsClient(
      vi.fn<typeof fetch>().mockResolvedValue(queryResponse(records)),
    );

    await expect(client.fetchProblems(config)).resolves.toMatchObject({
      totalCount: 10_000,
      resultTruncated: true,
    });
  });

  it('preserves Dynatrace retry guidance on rate-limit errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Too many queued queries.',
            retryAfterSeconds: 90,
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new DynatraceProblemsClient(fetchMock);

    const error = await client.testConnection(config).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(getDynatraceRetryAfterMs(error)).toBe(90_000);
    expect((error as Error).message).toMatch(/rate-limited/i);
  });

  it('returns a safe least-privilege error without echoing the platform token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({}, 403));
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(client.testConnection(config)).rejects.toThrow(/storage:events:read/i);
    await expect(client.testConnection(config)).rejects.not.toThrow(config.apiToken);
  });

  it('rejects malformed Grail records instead of storing them', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(queryResponse([{ unexpected: true }]));
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(client.fetchProblems(config)).rejects.toThrow(
      /unexpected Grail Problems response/i,
    );
  });
});
