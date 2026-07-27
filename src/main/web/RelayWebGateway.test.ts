import { createServer as createNetServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { RelayWebGateway } from './RelayWebGateway';
import { RelayWebServer } from './RelayWebServer';
import { WebApprovalCodeStore } from './WebApprovalCodeStore';

const LOOPBACK = '127.0.0.1';
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate synthetic credential exercises the approval-gated setup route.
const OWNER_PASSWORD = 'Test-access-value-123!';

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
