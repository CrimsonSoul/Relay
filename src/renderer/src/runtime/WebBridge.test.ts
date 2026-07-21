// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { WEB_RUNTIME } from '@shared/runtime';
import type { WebSessionBootstrap } from '@shared/webApi';
import { createWebBridge, createWebEventSubscriber } from './WebBridge';

const SESSION: WebSessionBootstrap = {
  csrfToken: 'c'.repeat(43),
  pbUrl: ['http', '://', 'relay-server', ':8090'].join(''),
  auth: { token: 'app-user-token', record: null },
  publicConfig: { mode: 'server', port: 8090 },
  runtime: WEB_RUNTIME,
};

const EMPTY_STATUS = {
  providers: Object.fromEntries(
    [
      'aws',
      'azure',
      'm365',
      'jira',
      'github',
      'cloudflare',
      'google',
      'anthropic',
      'openai',
      'salesforce',
    ].map((provider) => [provider, []]),
  ),
  lastUpdated: 0,
  errors: [],
};

const SIGNED_OUT = {
  state: 'signed-out' as const,
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

describe('WebBridge', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('provides an exhaustive safe bridge with the current in-memory connection', async () => {
    const bridge: BridgeAPI = createWebBridge(SESSION, {
      request: vi.fn(async (path: string) =>
        path === '/privileged/session' ? SIGNED_OUT : EMPTY_STATUS,
      ),
      subscribe: vi.fn(() => () => undefined),
    });

    for (const [name, value] of Object.entries(bridge)) {
      if (name !== 'runtime' && name !== 'platform') expect(value, name).toBeTypeOf('function');
    }
    await expect(bridge.getPbConnection()).resolves.toEqual({
      ok: true,
      connection: { pbUrl: SESSION.pbUrl, auth: SESSION.auth },
    });
    await expect(bridge.isConfigured()).resolves.toBe(true);
    await expect(bridge.getConfig()).resolves.toEqual(SESSION.publicConfig);
    await expect(bridge.saveConfig({})).resolves.toBe(false);
    await expect(bridge.createBackup()).resolves.toMatchObject({ success: false });
    await expect(bridge.getPrivilegedSession()).resolves.toMatchObject({ state: 'signed-out' });
  });

  it('uses exact routes and unsubscribes event listeners', async () => {
    const request = vi.fn(async () => EMPTY_STATUS);
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const bridge = createWebBridge(SESSION, { request, subscribe });

    await bridge.getCloudStatus();
    expect(request).toHaveBeenCalledWith('/operations/cloud-status', { method: 'GET' });

    const onChange = vi.fn();
    const cleanup = bridge.onDynatraceDashboardsChanged(onChange);
    expect(subscribe).toHaveBeenCalledWith('dynatrace-dashboards-changed', onChange);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('maps protected actions onto exact privileged routes', async () => {
    const request = vi.fn(async (path: string) => {
      if (path === '/privileged/session' || path === '/privileged/logout') return SIGNED_OUT;
      if (path === '/privileged/commands') {
        return { ok: true, requestId: 'request-1', value: { revision: 4 } };
      }
      return { ok: false, error: 'invalid-credentials' };
    });
    const bridge = createWebBridge(SESSION, { request });

    await bridge.loginPrivileged({ username: 'ryan', password: 'Test-access-value-123!' });
    await bridge.reauthenticatePrivileged({ password: 'Test-access-value-123!' });
    await bridge.submitPrivilegedCommand({
      command: 'administration.snapshot.read',
      payload: {},
      expectedRevision: null,
    });
    await bridge.logoutPrivileged();

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/privileged/login',
      '/privileged/reauthenticate',
      '/privileged/commands',
      '/privileged/logout',
    ]);
  });

  it('multiplexes subscriptions over one event stream and closes it when idle', () => {
    const instances: Array<{
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    class TestEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
      constructor(_url: string) {
        instances.push(this);
      }
    }
    const subscribe = createWebEventSubscriber(TestEventSource as unknown as typeof EventSource);

    const stopA = subscribe('alert-dismissed', vi.fn());
    const stopB = subscribe('dynatrace-dashboards-changed', vi.fn());
    expect(instances).toHaveLength(1);
    stopA();
    expect(instances[0]?.close).not.toHaveBeenCalled();
    stopB();
    expect(instances[0]?.close).toHaveBeenCalledOnce();
  });
});
