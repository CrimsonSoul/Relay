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
  afterEach(() => vi.unstubAllGlobals());

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
        id: 'dropbox-status-2026-08-21T15:12:53.480Z',
        provider: 'dropbox',
        title: 'Partially Degraded Service',
        description: 'Website: degraded performance',
        pubDate: '2026-08-21T15:12:53.480Z',
        link: 'https://status.dropbox.com',
        severity: 'warning',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://status.dropbox.com/api/v2/summary.json',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });
});
