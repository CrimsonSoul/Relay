import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { WebApprovalCodeStore } from '../WebApprovalCodeStore';
import { WebRequestSecurity } from '../WebRequestSecurity';
import { WebRouter, WEB_SESSION_COOKIE_NAME } from '../WebRouter';
import { WebSessionStore } from '../WebSessionStore';
import { registerPrivilegedRoutes, type WebPrivilegedRouteSession } from './privilegedRoutes';

const LOOPBACK = '127.0.0.1';
const PASSWORD = 'Test-access-value-123!';

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

const signedOut = () => ({
  state: 'signed-out' as const,
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
});

describe('Relay Web privileged routes', () => {
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

  async function fixture() {
    const port = await freePort();
    const origin = `http://${LOOPBACK}:${port}`;
    const ordinary = new WebSessionStore();
    const sessions = ['a', 'b'].map(() =>
      ordinary.create({
        pbUrl: `${origin}/pocketbase`,
        auth: { token: 'ordinary-token', record: null },
        publicConfig: { mode: 'server', port: 8090 },
        runtime: WEB_RUNTIME,
        refresh: async () => ({ token: 'fresh', record: null }),
      }),
    );
    const privileged = new Map<string, WebPrivilegedRouteSession>();
    for (const [index, session] of sessions.entries()) {
      let view: PrivilegedSessionView = signedOut();
      const runtime = {
        getView: vi.fn(() => view),
        login: vi.fn(async ({ username }: { username: string; password: string }) => {
          view = {
            state: 'active' as const,
            accountId: `account-${index}`,
            username,
            displayName: `Browser ${index}`,
            role: 'owner' as const,
            capabilities: ['privileged.status.read' as const, 'settings.manage' as const],
            deviceId: null,
            expiresAt: null,
          };
          return view;
        }),
        logout: vi.fn(async () => {
          view = signedOut();
        }),
        reauthenticate: vi.fn(async () => ({
          proofId: `proof-${index}`,
          expiresAt: '2026-07-20T12:05:00.000Z',
        })),
        createPairingChallenge: vi.fn(),
        completePairing: vi.fn(),
        submitPublicCommand: vi.fn(async () => ({
          ok: true as const,
          requestId: `command-${index}`,
          value: { revision: 4 },
        })),
      };
      privileged.set(session.id, {
        runtime,
        sourceLabel: index === 0 ? 'Chrome from 10.0.0.8' : 'Safari from 10.0.0.9',
      });
    }
    let approvalId = 0;
    const approvals = new WebApprovalCodeStore({
      randomCode: () => '123456',
      createId: () => `approval-${++approvalId}`,
    });
    const accountManager = {
      setupInitialAdministrator: vi.fn(async (input) => ({
        accountId: 'account-owner',
        username: input.username,
        displayName: 'Relay Owner',
        storedRole: 'administrator' as const,
        role: 'owner' as const,
        credentialState: 'configured' as const,
        credentialVersion: 1,
      })),
      setupCredential: vi.fn(),
    };
    const router = new WebRouter({
      security: new WebRequestSecurity({
        port,
        hostname: LOOPBACK,
        getInterfaceAddresses: () => [],
        connectOrigins: [],
      }),
      sessions: ordinary,
      authorizeCapability: (sessionId, capability) => {
        const view = privileged.get(sessionId)?.runtime.getView();
        return view?.state === 'active' && view.capabilities.includes(capability);
      },
    });
    registerPrivilegedRoutes(router, {
      getSession: (sessionId) => privileged.get(sessionId) ?? null,
      approvalCodes: approvals,
      getAccountManager: () => accountManager,
    });
    const server = createServer((request, response) => void router.handle(request, response));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(port, LOOPBACK, resolve));
    const headers = (index: number) => ({
      cookie: `${WEB_SESSION_COOKIE_NAME}=${sessions[index]!.id}`,
      origin,
      'x-relay-csrf': sessions[index]!.csrfToken,
      'content-type': 'application/json',
    });
    return { origin, sessions, privileged, approvals, accountManager, headers };
  }

  it('keeps browser login and logout isolated by ordinary session', async () => {
    const { origin, headers, privileged } = await fixture();
    const login = await fetch(`${origin}/relay-api/v1/privileged/login`, {
      method: 'POST',
      headers: headers(0),
      body: JSON.stringify({ username: 'ryan', password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    await expect(login.json()).resolves.toMatchObject({
      ok: true,
      value: { state: 'active', accountId: 'account-0', deviceId: null },
    });
    expect(privileged.get(privileged.keys().next().value!)?.runtime.getView().state).toBe('active');
    expect([...privileged.values()][1]?.runtime.getView().state).toBe('signed-out');

    const logout = await fetch(`${origin}/relay-api/v1/privileged/logout`, {
      method: 'POST',
      headers: headers(0),
    });
    expect(logout.status).toBe(200);
    expect([...privileged.values()][0]?.runtime.getView().state).toBe('signed-out');
    expect([...privileged.values()][1]?.runtime.logout).not.toHaveBeenCalled();
  });

  it('uses the existing public command allowlist and returns only the safe result', async () => {
    const { origin, headers, privileged } = await fixture();
    await fetch(`${origin}/relay-api/v1/privileged/login`, {
      method: 'POST',
      headers: headers(0),
      body: JSON.stringify({ username: 'ryan', password: PASSWORD }),
    });
    const valid = await fetch(`${origin}/relay-api/v1/privileged/commands`, {
      method: 'POST',
      headers: headers(0),
      body: JSON.stringify({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      }),
    });
    await expect(valid.json()).resolves.toEqual({
      ok: true,
      requestId: 'command-0',
      value: { revision: 4 },
    });

    const internal = await fetch(`${origin}/relay-api/v1/privileged/commands`, {
      method: 'POST',
      headers: headers(0),
      body: JSON.stringify({
        command: 'privileged.reauth.confirm',
        payload: { authenticatedAt: '2026-07-20T12:00:00.000Z' },
        expectedRevision: null,
      }),
    });
    expect(internal.status).toBe(400);
    expect([...privileged.values()][0]?.runtime.submitPublicCommand).toHaveBeenCalledOnce();
  });

  it('requires a matching desktop-issued approval for initial Owner setup', async () => {
    const { origin, headers, approvals, accountManager } = await fixture();
    const input = { username: 'ryan', password: PASSWORD, passwordConfirm: PASSWORD };
    const pending = await fetch(`${origin}/relay-api/v1/privileged/initial-owner`, {
      method: 'POST',
      headers: headers(0),
      body: JSON.stringify(input),
    });
    await expect(pending.json()).resolves.toMatchObject({
      ok: false,
      error: 'approval-required',
      approvalRequest: { requestId: 'approval-1', operation: 'initial-owner-credential' },
    });
    const code = approvals.generate('approval-1')!.code;

    const wrongSession = await fetch(`${origin}/relay-api/v1/privileged/initial-owner`, {
      method: 'POST',
      headers: headers(1),
      body: JSON.stringify({ ...input, approvalRequestId: 'approval-1', approvalCode: code }),
    });
    await expect(wrongSession.json()).resolves.toMatchObject({
      ok: false,
      error: 'approval-required',
    });
    expect(accountManager.setupInitialAdministrator).not.toHaveBeenCalled();

    const approved = await fetch(`${origin}/relay-api/v1/privileged/initial-owner`, {
      method: 'POST',
      headers: headers(0),
      body: JSON.stringify({ ...input, approvalRequestId: 'approval-1', approvalCode: code }),
    });
    await expect(approved.json()).resolves.toMatchObject({
      ok: true,
      value: { accountId: 'account-owner' },
    });
    expect(accountManager.setupInitialAdministrator).toHaveBeenCalledWith(input);
  });
});
