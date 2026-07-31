import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudStatusData, RadarSnapshot } from '@shared/ipc';
import { WEB_RUNTIME } from '@shared/runtime';
import { WebRequestSecurity } from '../WebRequestSecurity';
import { WebRouter, WEB_SESSION_COOKIE_NAME } from '../WebRouter';
import { WebSessionStore } from '../WebSessionStore';
import { registerOperationalRoutes, type OperationalServices } from './operationalRoutes';

const LOOPBACK = '127.0.0.1';

const RADAR_SNAPSHOT: RadarSnapshot = {
  color: 'green',
  dispatchers: [],
  papa: [],
  metrics: [],
  xcenter: { ok: 977, pending: 3 },
  currentTime: '10:02',
  lastUpdated: 1_785_515_320_000,
  signInRequired: false,
  error: null,
};

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

function emptyProviders(): CloudStatusData['providers'] {
  return {
    aws: [],
    azure: [],
    m365: [],
    jira: [],
    github: [],
    cloudflare: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  };
}

function services(): OperationalServices {
  return {
    cloudStatus: {
      refresh: vi.fn(async (): Promise<CloudStatusData> => ({
        providers: emptyProviders(),
        lastUpdated: 12,
        errors: [],
      })),
    },
    radar: {
      snapshot: vi.fn((): RadarSnapshot => RADAR_SNAPSHOT),
      refresh: vi.fn(async (): Promise<RadarSnapshot> => RADAR_SNAPSHOT),
    },
    dashboards: {
      list: vi.fn(() => []),
      add: vi.fn((input) => ({ success: true, data: { ...input, id: 'dash-1', state: 'closed' } })),
      update: vi.fn(() => ({ success: false, error: 'Not found' })),
      remove: vi.fn(() => ({ success: true })),
      url: vi.fn(() => 'https://abc.live.dynatrace.com/ui/apps/test'),
    },
    problems: {
      getSettings: vi.fn(() => ({
        configured: false,
        environmentUrl: '',
        profileFilterConfigured: false,
        selectedAlertingProfiles: [],
      })),
      saveSettings: vi.fn(() => ({ success: false, error: 'Not configured' })),
      testSettings: vi.fn(async () => ({ success: false, error: 'Not configured' })),
      clearSettings: vi.fn(() => ({ success: true })),
      sync: vi.fn(async () => ({ success: true, data: { count: 0 } })),
      saveProfileFilter: vi.fn(async () => ({ success: true, data: { count: 1 } })),
    },
    assets: {
      get: vi.fn(async () => null),
      save: vi.fn(async (_kind, dataUrl) => ({ success: true, data: dataUrl })),
      remove: vi.fn(async () => ({ success: true })),
    },
    log: vi.fn(),
  };
}

describe('Relay Web operational routes', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function fixture(authorizeCapability = true) {
    const port = await freePort();
    const origin = `http://${LOOPBACK}:${port}`;
    const sessions = new WebSessionStore();
    const session = sessions.create({
      pbUrl: `${origin}/pocketbase`,
      auth: { token: 'app-user-token', record: null },
      publicConfig: { mode: 'server', port: 8090 },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'refreshed', record: null }),
    });
    const operational = services();
    const router = new WebRouter({
      security: new WebRequestSecurity({
        port,
        hostname: LOOPBACK,
        getInterfaceAddresses: () => [],
        connectOrigins: [],
      }),
      sessions,
      authorizeCapability: vi.fn(() => authorizeCapability),
    });
    registerOperationalRoutes(router, { services: operational, sessions });
    const server = createServer((request, response) => void router.handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, LOOPBACK, resolve));
    return {
      origin,
      session,
      operational,
      headers: {
        cookie: `${WEB_SESSION_COOKIE_NAME}=${session.id}`,
        origin,
        'x-relay-csrf': session.csrfToken,
      },
    };
  }

  it('serves cloud status to an authenticated ordinary session', async () => {
    const { origin, headers, operational } = await fixture();
    const response = await fetch(`${origin}/relay-api/v1/operations/cloud-status`, { headers });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ lastUpdated: 12 });
    expect(operational.cloudStatus.refresh).toHaveBeenCalledOnce();
  });

  it('serves the current Radar snapshot only to an authenticated session', async () => {
    const { origin, headers, operational } = await fixture();
    const unauthenticated = await fetch(`${origin}/relay-api/v1/operations/radar`);
    expect(unauthenticated.status).toBe(401);

    const response = await fetch(`${origin}/relay-api/v1/operations/radar`, { headers });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(RADAR_SNAPSHOT);
    expect(operational.radar.snapshot).toHaveBeenCalledOnce();
    expect(operational.radar.refresh).not.toHaveBeenCalled();
  });

  it('requires CSRF for Radar refresh and returns the refreshed snapshot', async () => {
    const { origin, headers, operational } = await fixture();
    const withoutCsrf = await fetch(`${origin}/relay-api/v1/operations/radar/refresh`, {
      method: 'POST',
      headers: { cookie: headers.cookie, origin },
    });
    expect(withoutCsrf.status).toBe(403);
    expect(operational.radar.refresh).not.toHaveBeenCalled();

    const response = await fetch(`${origin}/relay-api/v1/operations/radar/refresh`, {
      method: 'POST',
      headers,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(RADAR_SNAPSHOT);
    expect(operational.radar.refresh).toHaveBeenCalledOnce();
  });

  it('rate limits Radar refresh after twelve requests per session per minute', async () => {
    const { origin, headers, operational } = await fixture();
    const request = () =>
      fetch(`${origin}/relay-api/v1/operations/radar/refresh`, { method: 'POST', headers });

    for (let requestIndex = 0; requestIndex < 12; requestIndex += 1) {
      expect((await request()).status).toBe(200);
    }
    const throttled = await request();

    expect(throttled.status).toBe(429);
    expect(operational.radar.refresh).toHaveBeenCalledTimes(12);
  });

  it('rejects a malformed Radar snapshot at the Web response boundary', async () => {
    const { origin, headers, operational } = await fixture();
    vi.mocked(operational.radar.snapshot).mockReturnValue({ cookie: 'must-not-cross' } as never);

    const response = await fetch(`${origin}/relay-api/v1/operations/radar`, { headers });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'unavailable' });
  });

  it('validates each dashboard mutation and requires settings capability', async () => {
    const allowed = await fixture();
    const valid = await fetch(
      `${allowed.origin}/relay-api/v1/operations/dynatrace-dashboards/add`,
      {
        method: 'POST',
        headers: { ...allowed.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Primary', url: 'https://abc.live.dynatrace.com/' }),
      },
    );
    expect(valid.status).toBe(200);
    expect(allowed.operational.dashboards.add).toHaveBeenCalledOnce();

    const invalid = await fetch(
      `${allowed.origin}/relay-api/v1/operations/dynatrace-dashboards/add`,
      {
        method: 'POST',
        headers: { ...allowed.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'remove-all' }),
      },
    );
    expect(invalid.status).toBe(400);
    expect(allowed.operational.dashboards.add).toHaveBeenCalledOnce();

    const denied = await fixture(false);
    const blocked = await fetch(
      `${denied.origin}/relay-api/v1/operations/dynatrace-dashboards/add`,
      {
        method: 'POST',
        headers: { ...denied.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Primary', url: 'https://abc.live.dynatrace.com/' }),
      },
    );
    expect(blocked.status).toBe(403);
    expect(denied.operational.dashboards.add).not.toHaveBeenCalled();
  });

  it('does not expose a generic operation dispatcher', async () => {
    const { origin, headers } = await fixture();
    const response = await fetch(`${origin}/relay-api/v1/operations/invoke`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'restoreBackup' }),
    });
    expect(response.status).toBe(404);
  });
});
