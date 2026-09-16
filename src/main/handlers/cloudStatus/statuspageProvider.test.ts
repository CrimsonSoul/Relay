import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStatuspageProvider, STATUSPAGE_FEEDS } from './statuspageProvider';

const CLOUDFLARE_SUMMARY_URL = 'https://www.cloudflarestatus.com/api/v2/summary.json';

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    page: {
      id: 'cloudflare',
      name: 'Cloudflare',
      url: 'https://www.cloudflarestatus.com/',
      updated_at: '2026-08-14T17:00:00.000Z',
    },
    components: [
      {
        id: 'harare',
        name: 'Harare, Zimbabwe - (HRE)',
        status: 'partial_outage',
      },
    ],
    incidents: [],
    scheduled_maintenances: [],
    status: { indicator: 'minor', description: 'Minor Service Outage' },
    ...overrides,
  };
}

describe('Statuspage providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('accepts an operational summary that omits incidents but includes components', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            page: { name: 'OpenAI' },
            status: { indicator: 'none', description: 'All Systems Operational' },
            components: [],
          }),
        ),
      ),
    );
    await expect(fetchStatuspageProvider(STATUSPAGE_FEEDS.openai!, 'openai')).resolves.toEqual([]);
  });

  it('keeps a freshly observed aggregate outage current with a stable identity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-16T19:00:00.000Z');
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            summary({
              page: { updated_at: '2026-06-14T05:20:31.963Z' },
              status: { indicator: 'major', description: 'Partial System Outage' },
            }),
          ),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = (await fetchStatuspageProvider(STATUSPAGE_FEEDS.equinix!, 'equinix'))[0]!;
    expect(first.pubDate).toBe('2026-09-16T19:00:00.000Z');
    expect(first.severity).toBe('error');
    vi.setSystemTime('2026-09-16T19:01:00.000Z');
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify(
            summary({
              page: { updated_at: '2026-09-16T19:00:30.000Z' },
              status: { indicator: 'major', description: 'Partial System Outage' },
            }),
          ),
        ),
    );
    const next = (await fetchStatuspageProvider(STATUSPAGE_FEEDS.equinix!, 'equinix'))[0]!;
    expect(next.id).toBe(first.id);
    expect(next.pubDate).toBe('2026-09-16T19:01:00.000Z');
  });

  it('does not manufacture a Cloudflare degradation from component-only aggregate state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(summary()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(fetchStatuspageProvider(CLOUDFLARE_SUMMARY_URL, 'cloudflare')).resolves.toEqual(
      [],
    );
  });

  it('keeps an active Cloudflare incident even when aggregate component state is noisy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            summary({
              incidents: [
                {
                  id: 'cloudflare-incident-1',
                  name: 'Elevated edge errors',
                  status: 'investigating',
                  impact: 'major',
                  created_at: '2026-08-14T17:00:00.000Z',
                  updated_at: '2026-08-14T17:05:00.000Z',
                  shortlink: 'https://www.cloudflarestatus.com/incidents/example',
                  incident_updates: [
                    {
                      body: 'Cloudflare is investigating elevated errors.',
                      created_at: '2026-08-14T17:05:00.000Z',
                    },
                  ],
                },
              ],
            }),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(fetchStatuspageProvider(CLOUDFLARE_SUMMARY_URL, 'cloudflare')).resolves.toEqual([
      expect.objectContaining({
        id: 'cloudflare-incident-1',
        provider: 'cloudflare',
        severity: 'error',
      }),
    ]);
  });

  it('maps the official Dropbox aggregate status into a degraded provider item', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          page: {
            id: 't34htyd6jblf',
            name: 'Dropbox',
            url: 'https://status.dropbox.com',
            updated_at: '2026-08-21T15:12:53.480Z',
          },
          status: { indicator: 'minor', description: 'Partially Degraded Service' },
          components: [{ name: 'Website', status: 'degraded_performance' }],
          incidents: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStatuspageProvider(STATUSPAGE_FEEDS.dropbox!, 'dropbox')).resolves.toEqual([
      {
        id: 'dropbox-status-minor',
        provider: 'dropbox',
        title: 'Partially Degraded Service',
        description: 'Website: degraded performance',
        pubDate: expect.any(String),
        link: 'https://status.dropbox.com',
        severity: 'warning',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://status.dropbox.com/api/v2/summary.json',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  it('maps the official Equinix aggregate status into an outage provider item', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          page: {
            id: 'equinix',
            name: 'Equinix Product Status',
            url: 'https://equinixproductstatus.statuspage.io/',
            updated_at: '2026-08-25T19:45:00.000Z',
          },
          status: { indicator: 'major', description: 'Partial System Outage' },
          components: [
            { name: 'Equinix Fabric', status: 'partial_outage' },
            { name: 'Equinix Metal', status: 'operational' },
          ],
          incidents: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStatuspageProvider(STATUSPAGE_FEEDS.equinix!, 'equinix')).resolves.toEqual([
      {
        id: 'equinix-status-major',
        provider: 'equinix',
        title: 'Partial System Outage',
        description: 'Equinix Fabric: partial outage',
        pubDate: expect.any(String),
        link: 'https://equinixproductstatus.statuspage.io',
        severity: 'error',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://equinixproductstatus.statuspage.io/api/v2/summary.json',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });
});

it.each([
  {},
  { incidents: [] },
  { status: { indicator: 'none', description: 'All systems operational' } },
  { incidents: [{}], status: { indicator: 'none', description: 'All systems operational' } },
  {
    incidents: null,
    components: [],
    status: { indicator: 'none', description: 'All systems operational' },
  },
])('rejects an incomplete summary %j', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  await expect(fetchStatuspageProvider(CLOUDFLARE_SUMMARY_URL, 'cloudflare')).rejects.toThrow(
    'Invalid Statuspage',
  );
  vi.unstubAllGlobals();
});
