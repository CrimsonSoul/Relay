import { createServer as createNetServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import type { CloudStatusData, RadarSnapshot } from '@shared/ipc';
import { WEB_RUNTIME } from '@shared/runtime';
import { RelayWebGateway } from './RelayWebGateway';
import { RelayWebServer } from './RelayWebServer';
import { WebApprovalCodeStore } from './WebApprovalCodeStore';
import type { OperationalServices } from './routes/operationalRoutes';

const LOOPBACK = '127.0.0.1';
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate synthetic credential exercises the approval-gated setup route.
const OWNER_PASSWORD = 'Test-access-value-123!';

const RADAR_SNAPSHOT: RadarSnapshot = {
  color: 'yellow',
  dispatchers: [],
  papa: [],
  metrics: [],
  xcenter: { ok: 977, pending: 3 },
  currentTime: '10:02',
  lastUpdated: 1_785_515_320_000,
  signInRequired: false,
  error: null,
};

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

function operationalEventsFixture() {
  let radarListener: ((snapshot: RadarSnapshot) => void) | undefined;
  const stopRadar = vi.fn();
  const stopDashboards = vi.fn();
  const services: OperationalServices = {
    cloudStatus: {
      refresh: async () => ({ providers: emptyProviders(), lastUpdated: 0, errors: [] }),
    },
    radar: {
      snapshot: () => RADAR_SNAPSHOT,
      refresh: async () => RADAR_SNAPSHOT,
      onChange: (listener) => {
        radarListener = listener;
        return stopRadar;
      },
    },
    dashboards: {
      list: () => [],
      add: () => ({ success: false, error: 'unused' }),
      update: () => ({ success: false, error: 'unused' }),
      remove: () => ({ success: false, error: 'unused' }),
      url: () => null,
      onChange: () => stopDashboards,
    },
    problems: {
      getSettings: () => ({
        configured: false,
        environmentUrl: '',
        profileFilterConfigured: false,
        selectedAlertingProfiles: [],
      }),
      saveSettings: () => ({ success: false, error: 'unused' }),
      testSettings: async () => ({ success: false, error: 'unused' }),
      clearSettings: () => ({ success: false, error: 'unused' }),
      sync: async () => ({ success: false, error: 'unused' }),
      saveProfileFilter: async () => ({ success: false, error: 'unused' }),
    },
    assets: {
      get: async () => null,
      save: async () => ({ success: false, error: 'unused' }),
      remove: async () => ({ success: false, error: 'unused' }),
    },
    log: () => undefined,
  };
  return {
    services,
    getRadarListener: () => radarListener,
    stopRadar,
    stopDashboards,
  };
}

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

function privilegedHostFixture() {
  const createdRuntimes: string[] = [];
  let approvalId = 0;
  const approvals = new WebApprovalCodeStore({
    randomCode: () => '123456',
    createId: () => `approval-${++approvalId}`,
  });
  const host = {
    createWebRuntime: ({ sessionId }: { sessionId: string }) => {
      createdRuntimes.push(sessionId);
      return {
        getView: () => ({
          state: 'signed-out' as const,
          accountId: null,
          username: null,
          displayName: null,
          role: null,
          capabilities: [],
          deviceId: null,
          expiresAt: null,
        }),
        onSessionChanged: () => () => undefined,
      };
    },
    disposeWebRuntime: async () => undefined,
    approvalCodes: approvals,
  };
  return { host: host as never, approvals, createdRuntimes };
}

const accountManager = {
  setupInitialAdministrator: async (input: { username: string }) => ({
    accountId: 'account-owner',
    username: input.username,
    displayName: 'Relay Owner',
    storedRole: 'administrator' as const,
    role: 'owner' as const,
    credentialState: 'configured' as const,
    credentialVersion: 1,
  }),
  setupCredential: async () => {
    throw new Error('Unused in this fixture');
  },
};

async function sessionHeaders(origin: string, response: Response): Promise<Record<string, string>> {
  const cookie = response.headers.get('set-cookie')!.split(';', 1)[0]!;
  const body = (await response.json()) as { session: { csrfToken: string } };
  return {
    cookie,
    origin,
    'x-relay-csrf': body.session.csrfToken,
    'content-type': 'application/json',
  };
}

describe('RelayWebGateway', () => {
  it('publishes validated Radar changes to session events and releases subscriptions', async () => {
    const port = await freePort();
    const operational = operationalEventsFixture();
    const gateway = new RelayWebGateway({
      config: {
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        secret: 'never-public',
        web: { enabled: true, port },
      },
      authenticate: async () => ({
        pbUrl: `http://${LOOPBACK}:8090`,
        auth: { token: 'app-user-token', record: null },
        publicConfig: {
          mode: 'server' as const,
          port: 8090,
          bindHost: '0.0.0.0' as const,
          lanIp: LOOPBACK,
          web: { enabled: true, port },
        },
        runtime: WEB_RUNTIME,
        refresh: async () => ({ token: 'refreshed-token', record: null }),
      }),
      hostname: LOOPBACK,
      getInterfaceAddresses: () => [],
      operationalServices: operational.services,
    });
    expect(operational.getRadarListener()).toBeTypeOf('function');
    if (!operational.getRadarListener()) {
      await gateway.dispose();
      return;
    }
    const server = new RelayWebServer({
      host: LOOPBACK,
      port,
      staticRoot: '/missing-static-root',
      gateway,
    });
    await server.start();
    const origin = `http://${LOOPBACK}:${port}`;

    try {
      const headers = await sessionHeaders(
        origin,
        await fetch(`${origin}/relay-api/v1/session/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake passphrase exercises authenticated SSE.
          body: JSON.stringify({ passphrase: 'fixture-passphrase' }),
        }),
      );
      const response = await fetch(`${origin}/relay-api/v1/session/events`, {
        headers: { cookie: headers.cookie! },
      });
      const reader = response.body!.getReader();
      const connected = await reader.read();
      expect(new TextDecoder().decode(connected.value)).toContain(': connected');

      operational.getRadarListener()?.({ cookie: 'must-not-cross' } as never);
      operational.getRadarListener()?.(RADAR_SNAPSHOT);
      const event = await reader.read();
      const eventText = new TextDecoder().decode(event.value);
      expect(eventText).not.toContain('must-not-cross');
      expect(eventText).toContain(
        `event: radar-snapshot-changed\ndata: ${JSON.stringify(RADAR_SNAPSHOT)}`,
      );

      await gateway.dispose();
      await expect(reader.read()).resolves.toMatchObject({ done: true });
      expect(operational.stopRadar).toHaveBeenCalledOnce();
      expect(operational.stopDashboards).toHaveBeenCalledOnce();
    } finally {
      await server.stop();
      await gateway.dispose();
    }
  });

  it('protects static content and provides live authenticated session routes on one origin', async () => {
    const port = await freePort();
    const authenticate = vi.fn(async () => ({
      pbUrl: `http://${LOOPBACK}:8090`,
      auth: { token: 'app-user-token', record: null },
      publicConfig: {
        mode: 'server' as const,
        port: 8090,
        bindHost: '0.0.0.0' as const,
        lanIp: LOOPBACK,
        web: { enabled: true, port },
      },
      runtime: WEB_RUNTIME,
      refresh: async () => ({ token: 'refreshed-token', record: null }),
    }));
    const gateway = new RelayWebGateway({
      config: {
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        secret: 'never-public',
        web: { enabled: true, port },
      },
      authenticate,
      hostname: LOOPBACK,
      getInterfaceAddresses: () => [],
    });
    const server = new RelayWebServer({
      host: LOOPBACK,
      port,
      staticRoot: '/missing-static-root',
      gateway,
    });
    await server.start();

    const origin = `http://${LOOPBACK}:${port}`;
    const staticResponse = await fetch(`${origin}/`);
    expect(staticResponse.status).toBe(404);
    expect(staticResponse.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    const rejectedMethod = await fetch(`${origin}/not-an-api`, { method: 'POST' });
    expect(rejectedMethod.status).toBe(405);
    expect(rejectedMethod.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );

    const loginResponse = await fetch(`${origin}/relay-api/v1/session/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake passphrase exercises the HTTP login boundary end to end.
      body: JSON.stringify({ passphrase: 'fixture-passphrase' }),
    });
    expect(loginResponse.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith('fixture-passphrase', LOOPBACK);
    expect(gateway.sessionCount).toBe(1);

    await server.stop();
    await gateway.dispose();
    expect(gateway.sessionCount).toBe(0);
  });

  it('keeps one privileged runtime and its pending approval across a refresh cookie rotation', async () => {
    const port = await freePort();
    const { host, approvals, createdRuntimes } = privilegedHostFixture();
    const gateway = new RelayWebGateway({
      config: {
        mode: 'server',
        port: 8090,
        bindHost: '0.0.0.0',
        secret: 'never-public',
        web: { enabled: true, port },
      },
      authenticate: async () => ({
        pbUrl: `http://${LOOPBACK}:8090`,
        auth: { token: 'app-user-token', record: null },
        publicConfig: {
          mode: 'server' as const,
          port: 8090,
          bindHost: '0.0.0.0' as const,
          lanIp: LOOPBACK,
          web: { enabled: true, port },
        },
        runtime: WEB_RUNTIME,
        refresh: async () => ({ token: 'refreshed-token', record: null }),
      }),
      hostname: LOOPBACK,
      getInterfaceAddresses: () => [],
      privilegedHost: host,
      getAccountManager: () => accountManager as never,
    });
    const server = new RelayWebServer({
      host: LOOPBACK,
      port,
      staticRoot: '/missing-static-root',
      gateway,
    });
    await server.start();

    try {
      const origin = `http://${LOOPBACK}:${port}`;
      const headers = await sessionHeaders(
        origin,
        await fetch(`${origin}/relay-api/v1/session/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake passphrase exercises the HTTP login boundary.
          body: JSON.stringify({ passphrase: 'fixture-passphrase' }),
        }),
      );
      const setup = {
        username: 'ryan',
        password: OWNER_PASSWORD,
        passwordConfirm: OWNER_PASSWORD,
      };
      const pending = await fetch(`${origin}/relay-api/v1/privileged/initial-owner`, {
        method: 'POST',
        headers,
        body: JSON.stringify(setup),
      });
      const pendingBody = (await pending.json()) as {
        approvalRequest?: { requestId: string };
      };
      expect(pendingBody.approvalRequest?.requestId).toBe('approval-1');
      const code = approvals.generate('approval-1')!.code;

      const refreshed = await fetch(`${origin}/relay-api/v1/session/refresh`, {
        method: 'POST',
        headers,
      });
      expect(refreshed.status).toBe(200);
      const rotated = await sessionHeaders(origin, refreshed);
      expect(rotated.cookie).not.toBe(headers.cookie);

      // The rotated cookie must reach the same privileged runtime, so the approval code issued
      // before the rotation is still consumable and no second runtime was built.
      const approved = await fetch(`${origin}/relay-api/v1/privileged/initial-owner`, {
        method: 'POST',
        headers: rotated,
        body: JSON.stringify({ ...setup, approvalRequestId: 'approval-1', approvalCode: code }),
      });
      await expect(approved.json()).resolves.toMatchObject({
        ok: true,
        value: { accountId: 'account-owner' },
      });
      expect(createdRuntimes).toHaveLength(1);
    } finally {
      await server.stop();
      await gateway.dispose();
    }
  });
});
