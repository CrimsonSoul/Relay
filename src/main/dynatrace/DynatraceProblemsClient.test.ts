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

  it('allows a large Grail query to keep polling beyond the per-request timeout', async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      requestCount += 1;
      if (requestCount <= 65) {
        return response({ state: 'RUNNING', requestToken: 'long-running-token' });
      }
      return queryResponse([{ problemCount: 3 }]);
    });
    const client = new DynatraceProblemsClient(fetchMock);

    const pending = client.testConnection(config);
    await vi.advanceTimersByTimeAsync(16_500);

    await expect(pending).resolves.toBe(3);
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

  it('uses the complete custom matcher instead of combining it with alerting profiles', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => queryResponse([problem()]));
    const client = new DynatraceProblemsClient(fetchMock);
    const workflowMatcher = `(
  matchesValue(entity_tags, "teams:network")
  or matchesValue(entity_tags, "critical_intf")
  or matchesValue(event.name, "UPS on battery*")
  or matchesPhrase(event.name, "Packet loss on")
  or matchesValue(affected_entity_types, "dt.entity.python:certificate_monitor_certificate")
  or matchesValue(labels.alerting_profile, "*WAN Links")
  or matchesValue(labels.alerting_profile, "*Alerts for NOC")
  or matchesValue(labels.alerting_profile, "Pure Array Latency")
  or matchesValue(labels.alerting_profile, "duo auth proxy on chpw-duoauth01")
)
and not matchesValue(event.status_transition, "UPDATED")
and maintenance.is_under_maintenance == false
and dt.davis.mute.status == "NOT_MUTED"`;

    await client.fetchProblems({
      ...config,
      alertingProfiles: ['Alerts for NOC'],
      customDqlMatcher: workflowMatcher,
    });

    const query = requestQuery(fetchMock, 0);
    const matcherAt = query.indexOf(workflowMatcher);
    const fieldsAt = query.indexOf('| fields problemId=event.id');
    expect(query).toContain(`| filter (\n${workflowMatcher}\n)`);
    expect(query).not.toContain('iAny(in(labels.alerting_profile[]');
    expect(matcherAt).toBeGreaterThan(-1);
    expect(fieldsAt).toBeGreaterThan(matcherAt);
  });

  it('keeps latest problems as the display source but evaluates custom scope on workflow events', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => queryResponse([problem()]));
    const client = new DynatraceProblemsClient(fetchMock);
    const matcher = `matchesValue(entity_tags, "teams:network")
and not matchesValue(event.status_transition, "UPDATED")`;

    await client.fetchProblems({
      ...config,
      customDqlMatcher: matcher,
    });

    const query = requestQuery(fetchMock, 0);
    const latestProblemsAt = query.indexOf('fetch dt.davis.problems, from:-365d');
    const workflowEventsAt = query.indexOf('fetch events, from:-365d');
    const matcherAt = query.indexOf(`| filter (\n${matcher}\n)`);
    const projectionAt = query.indexOf('| fields problemId=event.id');

    expect(latestProblemsAt).toBe(0);
    expect(query).toContain('| filter event.id in [');
    expect(query).toContain('| filter event.kind == "DAVIS_PROBLEM"');
    expect(workflowEventsAt).toBeGreaterThan(latestProblemsAt);
    expect(matcherAt).toBeGreaterThan(workflowEventsAt);
    expect(projectionAt).toBeGreaterThan(matcherAt);
  });
  it('enriches authoritative problem state with bounded metadata from matching workflow events', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        queryResponse([
          problem({
            title: 'Canonical Dynatrace problem title',
            status: 'ACTIVE',
            severity: 'AVAILABILITY',
          }),
        ]),
      )
      .mockResolvedValueOnce(
        queryResponse([
          {
            problemId: 'problem-1',
            workflowTitle: 'NOC · Checkout unavailable',
            workflowDescription: 'Customer checkout is failing in production.',
            workflowTags: ['teams:network', 'critical_intf', 'teams:network'],
            workflowAffectedEntityTypes: ['SERVICE', 'HOST'],
          },
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock);
    const matcher = 'matchesValue(entity_tags, "teams:network")';

    const result = await client.fetchProblems({ ...config, customDqlMatcher: matcher });

    expect(result.problems[0]).toMatchObject({
      title: 'Canonical Dynatrace problem title',
      status: 'OPEN',
      severity: 'AVAILABILITY',
      workflowTitle: 'NOC · Checkout unavailable',
      workflowDescription: 'Customer checkout is failing in production.',
      workflowTags: ['teams:network', 'critical_intf'],
      workflowAffectedEntityTypes: ['SERVICE', 'HOST'],
    });
    expect(result.workflowMetadataComplete).toBe(true);
    const metadataQuery = requestQuery(fetchMock, 1);
    expect(metadataQuery).toContain('fetch events, from:-365d');
    expect(metadataQuery).toContain('| filter event.kind == "DAVIS_PROBLEM"');
    expect(metadataQuery).toContain(
      '| fields problemId=event.id, workflowTitle=event.name, workflowDescription=event.description',
    );
    expect(metadataQuery).toContain('workflowTags=entity_tags');
    expect(metadataQuery).toContain('workflowAffectedEntityTypes=affected_entity_types');
  });

  it('keeps authoritative problem updates when the optional workflow metadata request fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        queryResponse([problem({ status: 'CLOSED', endTime: '2026-07-09T21:00:00.000Z' })]),
      )
      .mockRejectedValueOnce(new Error('Workflow projection unavailable'));
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems({
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });

    expect(result).toMatchObject({
      resultTruncated: false,
      workflowMetadataComplete: false,
      problems: [
        expect.objectContaining({
          problemId: 'problem-1',
          status: 'CLOSED',
          workflowTitle: '',
        }),
      ],
    });
  });

  it('keeps authoritative problem updates when a workflow metadata row is malformed', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse([problem({ severity: 'AVAILABILITY' })]))
      .mockResolvedValueOnce(
        queryResponse([{ problemId: 'problem-1', workflowTags: ['valid', 42] }]),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems({
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });

    expect(result).toMatchObject({
      resultTruncated: false,
      workflowMetadataComplete: false,
      problems: [
        expect.objectContaining({
          problemId: 'problem-1',
          severity: 'AVAILABILITY',
          workflowTags: [],
        }),
      ],
    });
  });

  it('does not treat a truncated workflow metadata projection as complete canonical scope', async () => {
    const metadata = { problemId: 'problem-1', workflowTitle: 'Partial NOC title' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse([problem()]))
      .mockResolvedValueOnce(
        queryResponse([metadata], {
          result: {
            records: [metadata],
            metadata: {
              grail: {
                notifications: [
                  {
                    notificationType: 'RESULT_RECORD_LIMIT_REACHED',
                    severity: 'WARN',
                    message: 'Result limit reached',
                  },
                ],
              },
            },
          },
        }),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems({
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });

    expect(result).toMatchObject({
      resultTruncated: false,
      workflowMetadataComplete: false,
      problems: [expect.objectContaining({ workflowTitle: '' })],
    });
  });

  it('bounds workflow metadata list values and aggregate size before persistence', async () => {
    const oversizedValue = 'x'.repeat(600);
    const oversizedList = Array.from(
      { length: 40 },
      (_, index) => `${index.toString().padStart(2, '0')}-${oversizedValue}`,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse([problem()]))
      .mockResolvedValueOnce(
        queryResponse([
          {
            problemId: 'problem-1',
            workflowTitle: 'NOC alert',
            workflowTags: oversizedList,
            workflowAffectedEntityTypes: oversizedList,
          },
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems({
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });

    const enriched = result.problems[0];
    expect(enriched?.workflowTags?.every((value) => value.length <= 512)).toBe(true);
    expect(enriched?.workflowAffectedEntityTypes?.every((value) => value.length <= 512)).toBe(true);
    expect(
      enriched?.workflowTags?.reduce((total, value) => total + value.length, 0),
    ).toBeLessThanOrEqual(8_000);
    expect(
      enriched?.workflowAffectedEntityTypes?.reduce((total, value) => total + value.length, 0),
    ).toBeLessThanOrEqual(8_000);
  });

  it('counts only currently active problems with the same canonical custom scope', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(queryResponse([{ problemCount: 0 }]));
    const client = new DynatraceProblemsClient(fetchMock);

    await expect(
      client.countMatchingProblems({
        ...config,
        customDqlMatcher: 'matchesPhrase(event.name, "No current match")',
      }),
    ).resolves.toBe(0);

    const query = requestQuery(fetchMock, 0);
    const activeAt = query.indexOf('| filter event.status == "ACTIVE"');
    const matcherAt = query.indexOf('| filter (\nmatchesPhrase(event.name, "No current match")\n)');
    expect(activeAt).toBeGreaterThan(-1);
    expect(matcherAt).toBeGreaterThan(activeAt);
    expect(query).toContain('| filter (\nmatchesPhrase(event.name, "No current match")\n)');
    expect(query).toContain('| summarize problemCount=count()');
    expect(query).not.toContain('| fields problemId=event.id');
  });

  it('pages a complete custom-scope reconciliation beyond the single-query record limit', async () => {
    const firstPage = Array.from({ length: 10_000 }, (_, index) =>
      problem({
        problemId: `problem-${index.toString().padStart(5, '0')}`,
        displayId: `P-${index}`,
      }),
    );
    const finalProblem = problem({ problemId: 'problem-10000', displayId: 'P-10000' });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse(firstPage))
      .mockResolvedValueOnce(queryResponse([finalProblem]))
      .mockResolvedValueOnce(queryResponse([]));
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems({
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });

    expect(result.totalCount).toBe(10_001);
    expect(result.problems.at(-1)?.problemId).toBe('problem-10000');
    expect(result.resultTruncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestQuery(fetchMock, 0)).toContain('| sort problemId asc');
    expect(requestQuery(fetchMock, 1)).toContain('| filter event.id > "problem-09999"');
    expect(requestQuery(fetchMock, 2)).toContain('fetch events, from:-365d');
  });

  it('observes unscoped changed problems during incremental custom-filter polling', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse([problem()]))
      .mockResolvedValueOnce(
        queryResponse([
          problem({ problemId: 'problem-1' }),
          problem({ problemId: 'problem-no-longer-matches' }),
        ]),
      )
      .mockResolvedValueOnce(queryResponse([]));
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems(
      {
        ...config,
        customDqlMatcher: 'dt.davis.mute.status == "NOT_MUTED"',
      },
      { mode: 'incremental', lookbackMinutes: 12 },
    );

    expect(result.changedProblems?.map((problem) => problem.problemId)).toEqual([
      'problem-1',
      'problem-no-longer-matches',
    ]);
    expect(requestQuery(fetchMock, 0)).toContain('dt.davis.mute.status == "NOT_MUTED"');
    expect(requestQuery(fetchMock, 1)).toContain('| fields problemId=event.id');
    expect(requestQuery(fetchMock, 1)).not.toContain('dt.davis.mute.status');
  });

  it('returns current details for every changed problem during incremental custom scope polling', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(queryResponse([problem({ problemId: 'problem-new-match' })]))
      .mockResolvedValueOnce(
        queryResponse([
          problem({ problemId: 'problem-new-match' }),
          problem({
            problemId: 'problem-existing-match',
            title: 'Latest title after an excluded update',
          }),
        ]),
      )
      .mockResolvedValueOnce(queryResponse([]));
    const client = new DynatraceProblemsClient(fetchMock);

    const result = await client.fetchProblems(
      {
        ...config,
        customDqlMatcher: 'not matchesValue(event.status_transition, "UPDATED")',
      },
      { mode: 'incremental', lookbackMinutes: 12 },
    );

    expect(result.changedProblems).toEqual([
      expect.objectContaining({ problemId: 'problem-new-match' }),
      expect.objectContaining({
        problemId: 'problem-existing-match',
        title: 'Latest title after an excluded update',
      }),
    ]);
    expect(requestQuery(fetchMock, 1)).toContain('| fields problemId=event.id');
    expect(requestQuery(fetchMock, 1)).not.toContain('event.status_transition');
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

  it('surfaces a safe Dynatrace query failure detail', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        state: 'FAILED',
        requestToken: 'failed-query-token',
        error: { message: 'DQL parse error near event.status_transition.' },
      }),
    );
    const client = new DynatraceProblemsClient(fetchMock);

    const error = await client.testConnection(config).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/DQL parse error near event\.status_transition/i);
    expect((error as Error).message).not.toContain(config.apiToken);
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
