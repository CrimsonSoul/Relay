import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStatuspageProvider } from './statuspageProvider';

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
});
