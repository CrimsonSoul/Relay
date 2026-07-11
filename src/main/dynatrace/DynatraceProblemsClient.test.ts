import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynatraceProblemsClient } from './DynatraceProblemsClient';

const config = {
  environmentUrl: 'https://abc123.apps.dynatrace.com',
  apiToken: 'dt0s16.platform-read-only-token',
  alertingProfiles: null,
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
      .fn()
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
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    const result = await client.fetchProblems(config);

    expect(result.problems).toHaveLength(2);
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

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://abc123.apps.dynatrace.com/platform/storage/query/v1/query:execute',
    );
    expect(init.headers.Authorization).toBe('Bearer dt0s16.platform-read-only-token');
    expect(JSON.parse(init.body)).toMatchObject({
      query: expect.stringContaining('fetch dt.davis.problems, from:-365d'),
      requestTimeoutMilliseconds: 12_000,
      maxResultRecords: 10_000,
    });
    expect(JSON.parse(init.body).query).toContain('smartscape.affected_entities');
    expect(JSON.parse(init.body).query).toContain('labels.alerting_profile');
    expect(JSON.parse(init.body).query).toContain('dedup event.id, sort:{timestamp desc}');
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/platform/storage/query/v1/query:poll?request-token=query-token',
    );
  });

  it('uses a bounded change window for incremental polls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(queryResponse([problem()]));
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    await client.fetchProblems(config, { mode: 'incremental', lookbackMinutes: 12 });

    const query = JSON.parse(fetchMock.mock.calls[0][1].body).query as string;
    expect(query).toContain('fetch dt.davis.problems, from:-12m');
    expect(query).not.toContain('from:-365d');
    expect(query.indexOf('dedup event.id')).toBeLessThan(query.indexOf('filter not'));
  });

  it('polls an asynchronous Grail query and returns the test count', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ state: 'RUNNING', requestToken: 'request + token', progress: 25 }),
      )
      .mockResolvedValueOnce(queryResponse([{ problemCount: '7' }]));
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    const pending = client.testConnection(config);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(7);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://abc123.apps.dynatrace.com/platform/storage/query/v1/query:poll?request-token=request+%2B+token',
    );
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer dt0s16.platform-read-only-token',
    );
  });

  it('keeps polling with the original token when later responses omit it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ state: 'RUNNING', requestToken: 'stable-token' }))
      .mockResolvedValueOnce(response({ state: 'RUNNING', progress: 75 }))
      .mockResolvedValueOnce(
        response({ state: 'SUCCEEDED', result: { records: [{ problemCount: 4 }] } }),
      );
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    const pending = client.testConnection(config);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(4);
    expect(String(fetchMock.mock.calls[1][0])).toContain('request-token=stable-token');
    expect(String(fetchMock.mock.calls[2][0])).toContain('request-token=stable-token');
  });

  it('filters the Grail query to any selected alerting profile with escaped literals', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        queryResponse([
          problem({ alertingProfiles: ['POS Store'], problemId: 'problem-filtered' }),
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    await client.fetchProblems({
      ...config,
      alertingProfiles: ['POS Store', 'NOC "Primary"'],
    });

    const query = JSON.parse(fetchMock.mock.calls[0][1].body).query as string;
    expect(query).toContain('iAny(in(labels.alerting_profile[]');
    expect(query).toContain('array("POS Store", "NOC \\"Primary\\"")');
  });

  it('loads a distinct sorted alerting profile catalog without storing problem records', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        queryResponse([
          { alertingProfile: 'POS Store' },
          { alertingProfile: 'Alerts for NOC' },
          { alertingProfile: 'POS Store' },
        ]),
      );
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    await expect(client.fetchAlertingProfiles(config)).resolves.toEqual([
      'Alerts for NOC',
      'POS Store',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).query).toContain(
      'expand alertingProfile=labels.alerting_profile',
    );
  });

  it('returns a safe least-privilege error without echoing the platform token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({}, 403));
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    await expect(client.testConnection(config)).rejects.toThrow(/storage:events:read/i);
    await expect(client.testConnection(config)).rejects.not.toThrow(config.apiToken);
  });

  it('rejects malformed Grail records instead of storing them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(queryResponse([{ unexpected: true }]));
    const client = new DynatraceProblemsClient(fetchMock as typeof fetch);

    await expect(client.fetchProblems(config)).rejects.toThrow(
      /unexpected Grail Problems response/i,
    );
  });
});
