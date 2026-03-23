import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron before importing the module
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../logger', () => ({
  loggers: {
    cloudStatus: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  },
}));

vi.mock('../rateLimiter', () => ({
  checkNetworkRateLimit: vi.fn(() => true),
}));

// We need to test the internal pure functions. Since they're not exported,
// we'll re-implement the test by importing the module and exercising the
// IPC handler which calls through to them. But first, let's test the
// logic by extracting what we can via the handler.

// For unit-testing the pure helpers we use a dynamic import trick:
// We'll call the setup, capture the handler, then invoke it with mocked fetch.

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';

const mockHandle = vi.mocked(ipcMain.handle);

// --- Helper: build RSS XML ---
function rssXml(
  items: {
    title: string;
    description: string;
    pubDate: string;
    guid: string;
    link?: string;
    status?: string;
  }[],
): string {
  const itemsXml = items
    .map(
      (i) => `
    <item>
      <title>${i.title}</title>
      <description><![CDATA[${i.description}]]></description>
      <pubDate>${i.pubDate}</pubDate>
      <guid>${i.guid}</guid>
      <link>${i.link ?? 'https://example.com'}</link>
      ${i.status ? `<status>${i.status}</status>` : ''}
    </item>
  `,
    )
    .join('');
  return `<?xml version="1.0"?><rss><channel>${itemsXml}</channel></rss>`;
}

// --- Helper: build Statuspage JSON ---
function statuspageJson(
  incidents: Partial<{
    id: string;
    name: string;
    status: string;
    impact: string;
    shortlink: string;
    created_at: string;
    updated_at: string;
    incident_updates: { body: string; created_at: string }[];
  }>[],
) {
  return JSON.stringify({
    incidents: incidents.map((inc) => ({
      id: inc.id ?? 'inc-1',
      name: inc.name ?? 'Test Incident',
      status: inc.status ?? 'investigating',
      impact: inc.impact ?? 'minor',
      shortlink: inc.shortlink ?? 'https://stspg.io/1',
      created_at: inc.created_at ?? '2026-02-28T10:00:00Z',
      updated_at: inc.updated_at ?? '2026-02-28T12:00:00Z',
      incident_updates: inc.incident_updates ?? [
        { body: 'Investigating', created_at: '2026-02-28T12:00:00Z' },
      ],
    })),
  });
}

// --- Helper: build Salesforce JSON ---
function salesforceJson(
  incidents: Partial<{
    id: number;
    status: string;
    type: string;
    createdAt: string;
    updatedAt: string;
    serviceKeys: string[];
    IncidentEvents: { message: string; createdAt: string }[];
    timeline: { content: string; createdAt: string }[];
  }>[],
) {
  return JSON.stringify(
    incidents.map((inc) => ({
      id: inc.id ?? 1,
      status: inc.status ?? 'Active',
      type: inc.type ?? 'Degradation',
      createdAt: inc.createdAt ?? '2026-02-28T10:00:00Z',
      updatedAt: inc.updatedAt ?? '2026-02-28T12:00:00Z',
      serviceKeys: inc.serviceKeys ?? ['core'],
      IncidentEvents: inc.IncidentEvents ?? [
        { message: 'Investigating', createdAt: '2026-02-28T13:00:00Z' },
      ],
      timeline: inc.timeline ?? [{ content: 'Timeline update', createdAt: '2026-02-28T14:00:00Z' }],
    })),
  );
}

describe('cloudStatusHandlers', () => {
  let handler: (...args: unknown[]) => Promise<unknown>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();
    mockHandle.mockReset();

    // Dynamic import so each test gets a fresh module with cleared cache
    const mod = await import('./cloudStatus');
    mod.setupCloudStatusHandlers();

    // Capture the registered IPC handler
    const call = mockHandle.mock.calls.find((c) => c[0] === IPC_CHANNELS.GET_CLOUD_STATUS);
    expect(call).toBeDefined();
    handler = call![1] as (...args: unknown[]) => Promise<unknown>;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- RSS parsing & severity inference ---

  it('parses RSS items and infers severity from status tag', async () => {
    const xml = rssXml([
      {
        title: 'Issue 1',
        description: 'Outage desc',
        pubDate: '2026-02-28T10:00:00Z',
        guid: 'g1',
        status: 'unavailable',
      },
      {
        title: 'Issue 2',
        description: 'Advisory',
        pubDate: '2026-02-28T11:00:00Z',
        guid: 'g2',
        status: 'advisory',
      },
      {
        title: 'Restored',
        description: 'Back up',
        pubDate: '2026-02-28T12:00:00Z',
        guid: 'g3',
        status: 'resolved',
      },
      {
        title: 'Normal',
        description: 'OK',
        pubDate: '2026-02-28T09:00:00Z',
        guid: 'g4',
        status: 'available',
      },
      {
        title: 'Degraded',
        description: 'Slow',
        pubDate: '2026-02-28T09:00:00Z',
        guid: 'g5',
        status: 'degraded',
      },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
      json: () => Promise.resolve({ incidents: [] }),
    });

    const result = (await handler()) as {
      providers: Record<string, { severity: string; title: string }[]>;
    };
    const awsItems = result.providers.aws;

    expect(awsItems).toHaveLength(5);
    expect(awsItems.find((i) => i.title === 'Issue 1')?.severity).toBe('error');
    expect(awsItems.find((i) => i.title === 'Issue 2')?.severity).toBe('warning');
    expect(awsItems.find((i) => i.title === 'Restored')?.severity).toBe('resolved');
    expect(awsItems.find((i) => i.title === 'Normal')?.severity).toBe('info');
    expect(awsItems.find((i) => i.title === 'Degraded')?.severity).toBe('warning');
  });

  it('infers severity from text content when no status tag', async () => {
    const xml = rssXml([
      {
        title: 'Major outage in us-east-1',
        description: '',
        pubDate: '2026-02-28T10:00:00Z',
        guid: 'g1',
      },
      {
        title: 'Normal service',
        description: 'resolved and operating normally',
        pubDate: '2026-02-28T11:00:00Z',
        guid: 'g2',
      },
      {
        title: 'Elevated errors',
        description: 'intermittent failures',
        pubDate: '2026-02-28T12:00:00Z',
        guid: 'g3',
      },
      { title: 'Update', description: 'general info', pubDate: '2026-02-28T09:00:00Z', guid: 'g4' },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
      json: () => Promise.resolve({ incidents: [] }),
    });

    const result = (await handler()) as {
      providers: Record<string, { severity: string; title: string }[]>;
    };
    const awsItems = result.providers.aws;

    expect(awsItems.find((i) => i.title.includes('outage'))?.severity).toBe('error');
    expect(awsItems.find((i) => i.title.includes('Normal'))?.severity).toBe('resolved');
    expect(awsItems.find((i) => i.title.includes('Elevated'))?.severity).toBe('warning');
    expect(awsItems.find((i) => i.title === 'Update')?.severity).toBe('info');
  });

  it('filters out M365 boilerplate message', async () => {
    const xml = rssXml([
      {
        title: 'Microsoft Admin Center',
        description:
          'This site is updated when service issues are preventing tenant administrators from accessing',
        pubDate: '2026-02-28T10:00:00Z',
        guid: 'g1',
      },
      {
        title: 'Real Issue',
        description: 'Actual problem',
        pubDate: '2026-02-28T11:00:00Z',
        guid: 'g2',
      },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
      json: () => Promise.resolve({ incidents: [] }),
    });

    const result = (await handler()) as { providers: Record<string, { title: string }[]> };
    // M365 is the third RSS provider
    const m365Items = result.providers.m365;
    expect(m365Items).toHaveLength(1);
    expect(m365Items[0]!.title).toBe('Real Issue');
  });

  // --- Statuspage parsing & severity ---

  it('parses Statuspage incidents with correct severity and latest update timestamp', async () => {
    const json = statuspageJson([
      {
        id: 'inc-1',
        name: 'Major outage',
        impact: 'critical',
        status: 'investigating',
        incident_updates: [{ body: 'Latest update', created_at: '2026-02-28T15:00:00Z' }],
      },
      { id: 'inc-2', name: 'Resolved', impact: 'minor', status: 'resolved' },
      { id: 'inc-3', name: 'Major impact', impact: 'major', status: 'identified' },
      { id: 'inc-4', name: 'Postmortem', impact: 'critical', status: 'postmortem' },
    ]);

    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('githubstatus'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(json)) });
      if (url.includes('cloudflarestatus') || url.includes('anthropic') || url.includes('openai'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ incidents: [] }) });
      if (url.includes('google'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url.includes('salesforce'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as {
      providers: Record<string, { severity: string; pubDate: string; title: string }[]>;
    };
    const ghItems = result.providers.github;

    expect(ghItems).toHaveLength(4);
    expect(ghItems.find((i) => i.title === 'Major outage')?.severity).toBe('error');
    expect(ghItems.find((i) => i.title === 'Major outage')?.pubDate).toBe('2026-02-28T15:00:00Z');
    expect(ghItems.find((i) => i.title === 'Resolved')?.severity).toBe('resolved');
    expect(ghItems.find((i) => i.title === 'Major impact')?.severity).toBe('error');
    expect(ghItems.find((i) => i.title === 'Postmortem')?.severity).toBe('resolved');
  });

  it('falls back to updated_at when no incident_updates', async () => {
    const json = JSON.stringify({
      incidents: [
        {
          id: 'inc-1',
          name: 'Test',
          status: 'investigating',
          impact: 'minor',
          shortlink: '',
          created_at: '2026-02-28T10:00:00Z',
          updated_at: '2026-02-28T14:00:00Z',
          incident_updates: [],
        },
      ],
    });

    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('githubstatus'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(json)) });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as { providers: Record<string, { pubDate: string }[]> };
    expect(result.providers.github[0]?.pubDate).toBe('2026-02-28T14:00:00Z');
  });

  // --- Google Cloud parsing ---

  it('parses Google Cloud incidents with most_recent_update timestamp', async () => {
    const now = Date.now();
    const t = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const DAY = 24 * 60 * 60 * 1000;

    // gc-1: ongoing outage 5 days ago with a most_recent_update
    const gc1Begin = t(-5 * DAY);
    const gc1Modified = t(-5 * DAY + 2 * 3600_000);
    const gc1MostRecent = t(-5 * DAY + 6 * 3600_000);

    // gc-2: resolved 4 days ago, no most_recent_update — pubDate falls to modified
    const gc2Begin = t(-4 * DAY);
    const gc2End = t(-4 * DAY + 3 * 3600_000);
    const gc2Modified = t(-4 * DAY + 5 * 3600_000);

    const incidents = [
      {
        id: 'gc-1',
        external_desc: 'Outage',
        begin: gc1Begin,
        modified: gc1Modified,
        status_impact: 'SERVICE_OUTAGE',
        uri: '/incidents/1',
        most_recent_update: { text: 'Outage update', when: gc1MostRecent },
      },
      {
        id: 'gc-2',
        external_desc: 'Resolved',
        begin: gc2Begin,
        end: gc2End,
        modified: gc2Modified,
        status_impact: 'SERVICE_DISRUPTION',
        uri: '/incidents/2',
      },
    ];

    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('status.cloud.google'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(incidents) });
      if (url.includes('salesforce'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as {
      providers: Record<string, { severity: string; pubDate: string }[]>;
    };
    const gcItems = result.providers.google;

    expect(gcItems[0]?.severity).toBe('error');
    expect(gcItems[0]?.pubDate).toBe(gc1MostRecent);
    // Ended incident with no most_recent_update falls to 'modified'
    expect(gcItems[1]?.severity).toBe('resolved');
    expect(gcItems[1]?.pubDate).toBe(gc2Modified);
  });

  // --- Salesforce parsing ---

  it('parses Salesforce incidents with latest timeline timestamp', async () => {
    const json = salesforceJson([
      {
        type: 'Major Outage',
        serviceKeys: ['NA44', 'EU15'],
        timeline: [{ content: 'Latest update', createdAt: '2026-02-28T16:00:00Z' }],
      },
      { id: 2, type: 'Maintenance', status: 'Completed', serviceKeys: [] },
    ]);

    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('salesforce'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(json)) });
      if (url.includes('google'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as {
      providers: Record<string, { severity: string; pubDate: string; title: string }[]>;
    };
    const sfItems = result.providers.salesforce;

    expect(sfItems[0]?.severity).toBe('error');
    expect(sfItems[0]?.pubDate).toBe('2026-02-28T16:00:00Z');
    expect(sfItems[0]?.title).toContain('NA44');
    expect(sfItems[1]?.severity).toBe('resolved');
  });

  it('Salesforce falls back through timestamp chain', async () => {
    const json = JSON.stringify([
      {
        id: 1,
        status: 'Active',
        type: 'Degradation',
        createdAt: '2026-02-28T10:00:00Z',
        updatedAt: '2026-02-28T13:00:00Z',
        serviceKeys: [],
        IncidentEvents: [{ message: 'Event msg', createdAt: '2026-02-28T14:00:00Z' }],
        timeline: [],
      },
    ]);

    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('salesforce'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(json)) });
      if (url.includes('google'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as {
      providers: Record<string, { pubDate: string; description: string }[]>;
    };
    // Empty timeline → falls to IncidentEvents[0].createdAt
    expect(result.providers.salesforce[0]?.pubDate).toBe('2026-02-28T14:00:00Z');
    expect(result.providers.salesforce[0]?.description).toBe('Event msg');
  });

  // --- Error handling ---

  it('handles fetch failures gracefully per provider', async () => {
    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('aws')) return Promise.reject(new Error('Network error'));
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as {
      errors: { provider: string; message: string }[];
      providers: Record<string, unknown[]>;
    };
    expect(result.errors.some((e) => e.provider === 'aws')).toBe(true);
    // Other providers should still have data
    expect(result.providers.azure).toBeDefined();
  });

  it('handles HTTP error responses', async () => {
    const rssEmpty = rssXml([]);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('aws'))
        return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssEmpty),
        json: () => Promise.resolve({ incidents: [] }),
      });
    });

    const result = (await handler()) as { errors: { provider: string }[] };
    expect(result.errors.some((e) => e.provider === 'aws')).toBe(true);
  });

  // --- Caching ---

  it('returns cached data on subsequent calls within TTL', async () => {
    const rssEmpty = rssXml([]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(rssEmpty),
      json: () => Promise.resolve({ incidents: [] }),
    });
    globalThis.fetch = mockFetch;

    const result1 = await handler();
    const callCount1 = mockFetch.mock.calls.length;

    const result2 = await handler();
    // Should not have made more fetch calls
    expect(mockFetch.mock.calls.length).toBe(callCount1);
    expect(result1).toEqual(result2);
  });
});
