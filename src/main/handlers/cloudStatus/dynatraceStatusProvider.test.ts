import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDynatraceStatusProvider } from './dynatraceStatusProvider';

const NOW = Date.parse('2026-08-08T20:00:00.000Z');

function statusIoResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    result: {
      status_overall: {
        updated: '2026-08-08T18:36:52.392Z',
        status: 'Service Disruption',
        status_code: 400,
      },
      status: [],
      incidents: [
        {
          _id: 'incident-1',
          name: 'Potential delay in logs and metrics ingestion',
          datetime_open: '2026-08-08T18:00:00.000Z',
          current_active: true,
          messages: [
            {
              details: 'Customers may experience processing delays.',
              state: 300,
              status: 300,
              datetime: '2026-08-08T19:00:00.000Z',
            },
          ],
          containers_affected: [{ _id: 'container-1', name: 'Process-AWS-americas' }],
          components_affected: [{ _id: 'component-1', name: 'Dynatrace Product' }],
        },
      ],
      maintenance: [],
      ...overrides,
    },
  };
}

function mockResponse(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

describe('Dynatrace Status.io provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps a degraded active incident and its affected cloud region', async () => {
    mockResponse(statusIoResponse());

    await expect(fetchDynatraceStatusProvider(NOW)).resolves.toEqual([
      {
        id: 'incident-1',
        provider: 'dynatrace',
        title: 'Potential delay in logs and metrics ingestion',
        description: 'Customers may experience processing delays.',
        pubDate: '2026-08-08T19:00:00.000Z',
        link: 'https://dynatrace.status.io/',
        severity: 'warning',
        affectedScopes: ['AWS · Americas'],
      },
    ]);
  });

  it('uses the latest disruptive update and ignores operational monitoring updates', async () => {
    const disruptive = {
      _id: 'incident-2',
      name: 'Service interruption',
      datetime_open: '2026-08-08T17:00:00.000Z',
      current_active: true,
      messages: [
        {
          details: 'Performance is degraded.',
          state: 300,
          status: 300,
          datetime: '2026-08-08T18:00:00.000Z',
        },
        {
          details: 'The service is partially unavailable.',
          state: 300,
          status: 400,
          datetime: '2026-08-08T19:30:00.000Z',
        },
      ],
      containers_affected: [{ _id: 'container-2', name: 'Retain-Azure-asia-pacific' }],
      components_affected: [{ _id: 'component-1', name: 'Dynatrace Product' }],
    };
    const monitoring = {
      ...disruptive,
      _id: 'incident-monitoring',
      name: 'Monitoring after mitigation',
      messages: [
        {
          details: 'Service is operational and being monitored.',
          state: 300,
          status: 100,
          datetime: '2026-08-08T19:45:00.000Z',
        },
      ],
    };
    mockResponse(statusIoResponse({ incidents: [disruptive, monitoring] }));

    await expect(fetchDynatraceStatusProvider(NOW)).resolves.toEqual([
      {
        id: 'incident-2',
        provider: 'dynatrace',
        title: 'Service interruption',
        description: 'The service is partially unavailable.',
        pubDate: '2026-08-08T19:30:00.000Z',
        link: 'https://dynatrace.status.io/',
        severity: 'error',
        affectedScopes: ['AZURE · Asia Pacific'],
      },
    ]);
  });

  it('excludes closed, stale, maintenance, and security-only notices', async () => {
    const incident = {
      _id: 'filtered-incident',
      name: 'Degraded service',
      datetime_open: '2026-08-08T17:00:00.000Z',
      current_active: true,
      messages: [
        {
          details: 'Status update.',
          state: 300,
          status: 300,
          datetime: '2026-08-08T19:00:00.000Z',
        },
      ],
      containers_affected: [],
      components_affected: [{ _id: 'component-1', name: 'Dynatrace Product' }],
    };
    mockResponse(
      statusIoResponse({
        incidents: [
          { ...incident, _id: 'closed', current_active: false },
          {
            ...incident,
            _id: 'stale',
            messages: [
              {
                details: 'Old degradation.',
                state: 300,
                status: 300,
                datetime: '2026-07-31T19:00:00.000Z',
              },
            ],
          },
          { ...incident, _id: 'maintenance', name: 'Scheduled maintenance for SaaS' },
          { ...incident, _id: 'security', name: 'Security advisory CVE-2026-12345' },
        ],
      }),
    );

    await expect(fetchDynatraceStatusProvider(NOW)).resolves.toEqual([]);
  });

  it('rejects an unbounded incident collection', async () => {
    const incidents = Array.from({ length: 101 }, (_, index) => ({
      _id: `incident-${index}`,
      name: `Degraded service ${index}`,
      datetime_open: '2026-08-08T17:00:00.000Z',
      current_active: true,
      messages: [
        {
          details: 'Status update.',
          state: 300,
          status: 300,
          datetime: '2026-08-08T19:00:00.000Z',
        },
      ],
      containers_affected: [],
      components_affected: [{ _id: 'component-1', name: 'Dynatrace Product' }],
    }));
    mockResponse(statusIoResponse({ incidents }));

    await expect(fetchDynatraceStatusProvider(NOW)).rejects.toThrow(
      'Invalid Dynatrace Status.io response',
    );
  });

  it('rejects a response advertised beyond the payload limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(statusIoResponse()), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': '2097153',
          },
        }),
      ),
    );

    await expect(fetchDynatraceStatusProvider(NOW)).rejects.toThrow(
      'Dynatrace Status.io response exceeds 2097152 bytes',
    );
  });

  it('measures the response when content length is absent', async () => {
    mockResponse(statusIoResponse({ padding: 'x'.repeat(2_097_152) }));

    await expect(fetchDynatraceStatusProvider(NOW)).rejects.toThrow(
      'Dynatrace Status.io response exceeds 2097152 bytes',
    );
  });

  it('rejects an incident with an unbounded update history', async () => {
    const body = statusIoResponse();
    const result = body.result as { incidents: Array<{ messages: unknown[] }> };
    result.incidents[0]!.messages = Array.from({ length: 101 }, (_, index) => ({
      details: `Status update ${index}.`,
      state: 300,
      status: 300,
      datetime: `2026-08-08T19:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }));
    mockResponse(body);

    await expect(fetchDynatraceStatusProvider(NOW)).rejects.toThrow(
      'Invalid Dynatrace Status.io response',
    );
  });

  it('rejects an incident with an unbounded affected-scope collection', async () => {
    const body = statusIoResponse();
    const result = body.result as {
      incidents: Array<{ containers_affected: unknown[] }>;
    };
    result.incidents[0]!.containers_affected = Array.from({ length: 101 }, (_, index) => ({
      _id: `container-${index}`,
      name: `Process-AWS-region-${index}`,
    }));
    mockResponse(body);

    await expect(fetchDynatraceStatusProvider(NOW)).rejects.toThrow(
      'Invalid Dynatrace Status.io response',
    );
  });

  it.each([
    ['identifier', (incident: Record<string, unknown>) => (incident._id = 'x'.repeat(513))],
    ['title', (incident: Record<string, unknown>) => (incident.name = 'x'.repeat(2_001))],
    [
      'description',
      (incident: Record<string, unknown>) =>
        ((incident.messages as Record<string, unknown>[])[0]!.details = 'x'.repeat(20_001)),
    ],
    [
      'timestamp',
      (incident: Record<string, unknown>) =>
        ((incident.messages as Record<string, unknown>[])[0]!.datetime = 'x'.repeat(101)),
    ],
    [
      'affected scope',
      (incident: Record<string, unknown>) =>
        ((incident.containers_affected as Record<string, unknown>[])[0]!.name = 'x'.repeat(201)),
    ],
  ])('ignores an incident with an oversized %s', async (_field, mutate) => {
    const body = statusIoResponse();
    const result = body.result as { incidents: Record<string, unknown>[] };
    mutate(result.incidents[0]!);
    mockResponse(body);

    await expect(fetchDynatraceStatusProvider(NOW)).resolves.toEqual([]);
  });
});
