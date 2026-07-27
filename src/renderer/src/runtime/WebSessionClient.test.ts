import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { WEB_RUNTIME } from '@shared/runtime';
import type { WebSessionBootstrap } from '@shared/webApi';
import { WebSessionClient } from './WebSessionClient';

const SESSION: WebSessionBootstrap = {
  csrfToken: 'c'.repeat(43),
  pbUrl: ['http', '://', 'relay-server', ':8090'].join(''),
  auth: { token: 'app-user-token', record: null },
  publicConfig: {
    mode: 'server',
    port: 8090,
    bindHost: '0.0.0.0',
    lanIp: ['192', '168', '1', '25'].join('.'),
  },
  runtime: WEB_RUNTIME,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WebSessionClient', () => {
  const fetcher = vi.fn();
  const install = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.api = undefined;
  });

  it('bootstraps through same-origin noncached cookie credentials and validates the result', async () => {
    fetcher.mockResolvedValue(jsonResponse({ ok: true, session: SESSION }));
    const client = new WebSessionClient({ fetcher, install });

    await expect(client.bootstrap()).resolves.toEqual({ ok: true, session: SESSION });
    expect(fetcher).toHaveBeenCalledWith('/relay-api/v1/session/bootstrap', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
    });

    fetcher.mockResolvedValueOnce(jsonResponse({ ok: true, session: { token: 'malformed' } }));
    await expect(client.bootstrap()).resolves.toEqual({ ok: false, error: 'unavailable' });
  });

  it('invokes browser fetch without binding the WebSessionClient as its receiver', async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Promise.resolve(jsonResponse({ ok: false, error: 'unauthenticated' }, 401));
    }) as unknown as typeof fetch;
    const client = new WebSessionClient({ fetcher: browserFetch });

    await expect(client.bootstrap()).resolves.toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('submits the exact passphrase in a bounded login request and never stores it', async () => {
    const passphrase = '  exact browser passphrase  ';
    fetcher.mockResolvedValue(jsonResponse({ ok: true, session: SESSION }));
    const client = new WebSessionClient({ fetcher, install });

    await expect(client.login({ passphrase })).resolves.toEqual({ ok: true, session: SESSION });
    expect(fetcher).toHaveBeenCalledWith(
      '/relay-api/v1/session/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ passphrase }),
        credentials: 'same-origin',
      }),
    );
    expect(JSON.stringify(client)).not.toContain(passphrase);
  });

  it('activates the shared runtime and uses the active CSRF value for refresh and logout', async () => {
    fetcher
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, session: { ...SESSION, auth: { token: 'new', record: null } } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const cleanup = vi.fn();
    install.mockReturnValue(cleanup);
    const client = new WebSessionClient({ fetcher, install });
    await client.activate(SESSION);

    expect(install).toHaveBeenCalledWith(SESSION);
    await expect(client.refresh()).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      '/relay-api/v1/session/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Relay-CSRF': SESSION.csrfToken }),
      }),
    );
    await expect(client.logout()).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/relay-api/v1/session/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Relay-CSRF': 'c'.repeat(43) }),
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('maps a throttled sign-in to rate-limited instead of the generic unavailable state', async () => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'rate-limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '30' },
      }),
    );
    const client = new WebSessionClient({ fetcher, install });

    await expect(client.login({ passphrase: 'exact browser passphrase' })).resolves.toEqual({
      ok: false,
      error: 'rate-limited',
    });
  });

  it('keeps one event stream across the bridge reinstall that every refresh performs', async () => {
    const instances: unknown[] = [];
    class TestEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
      constructor(_url: string) {
        instances.push(this);
      }
    }
    vi.stubGlobal('EventSource', TestEventSource);
    const client = new WebSessionClient({ fetcher });

    await client.activate(SESSION);
    // A shell-level subscriber never unsubscribes, so it stays attached to the first stream.
    globalThis.api!.onAlertDismissed(vi.fn());
    await client.activate({ ...SESSION, csrfToken: 'd'.repeat(43) });
    globalThis.api!.onAlertDismissed(vi.fn());

    expect(instances).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('installs a bootstrap bridge that exposes only the current session connection', async () => {
    const client = new WebSessionClient();
    await client.activate(SESSION);

    expect(globalThis.api?.runtime).toEqual(WEB_RUNTIME);
    expect(globalThis.api?.platform).toBeTypeOf('string');
    await expect(globalThis.api!.isConfigured()).resolves.toBe(true);
    await expect(globalThis.api!.getConfig()).resolves.toEqual(SESSION.publicConfig);
    await expect(globalThis.api!.getPbConnection()).resolves.toEqual({
      ok: true,
      connection: { pbUrl: SESSION.pbUrl, auth: SESSION.auth },
    });
    expect(globalThis.api).toEqual(expect.any(Object) as BridgeAPI);
  });
});
