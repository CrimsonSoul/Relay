import { describe, expect, it, vi } from 'vitest';
import { WebSessionStore } from './WebSessionStore';
import { WebPrivilegedSession } from './WebPrivilegedSession';

const PRIVATE_ADDRESS = ['10', '0', '0', '8'].join('.');

describe('WebPrivilegedSession', () => {
  it('uses bounded browser metadata, publishes safe views, and follows ordinary-session cleanup', async () => {
    const sessions = new WebSessionStore({ randomBytes: (size) => new Uint8Array(size).fill(7) });
    const ordinary = sessions.create({
      pbUrl: 'http://127.0.0.1:8090',
      auth: { token: 'ordinary-token', record: null },
      publicConfig: { mode: 'server', port: 8090 },
      runtime: {
        kind: 'web',
        label: 'Web',
        capabilities: {
          connectionConfiguration: false,
          pocketBaseRecovery: false,
          offlineCache: false,
          offlineMutations: false,
          nativeWindowControls: false,
          customReminderSound: false,
          imageClipboard: false,
          privilegedAccess: true,
          knowledgePublishing: true,
        },
      },
      refresh: async () => ({ token: 'fresh', record: null }),
    });
    let sessionChanged: ((view: unknown) => void) | null = null;
    const runtime = {
      getView: vi.fn(() => ({
        state: 'signed-out',
        accountId: null,
        username: null,
        displayName: null,
        role: null,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      })),
      onSessionChanged: vi.fn((listener) => {
        sessionChanged = listener;
        return vi.fn();
      }),
    };
    const host = {
      createWebRuntime: vi.fn(() => runtime),
      disposeWebRuntime: vi.fn(async () => undefined),
      approvalCodes: { clearSession: vi.fn() },
    };
    const events: Array<{ event: string; data: unknown }> = [];
    sessions.subscribeEvents(ordinary.id, (event, data) => events.push({ event, data }));

    const privileged = new WebPrivilegedSession({
      sessionId: ordinary.id,
      host: host as never,
      sessions,
      userAgent: 'Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36 secret-token-value-that-must-not-leak',
      remoteAddress: `::ffff:${PRIVATE_ADDRESS}`,
    });

    expect(host.createWebRuntime).toHaveBeenCalledWith({
      sessionId: ordinary.id,
      source: { browserFamily: 'Chrome', addressLabel: PRIVATE_ADDRESS },
    });
    expect(privileged.sourceLabel).toBe('Chrome from 10.0.0.8');
    (sessionChanged as ((view: unknown) => void) | null)?.({
      state: 'active',
      capabilities: ['settings.manage'],
    });
    expect(events).toEqual([
      {
        event: 'privileged-session-changed',
        data: { state: 'active', capabilities: ['settings.manage'] },
      },
    ]);

    await sessions.destroy(ordinary.id);
    expect(host.approvalCodes.clearSession).toHaveBeenCalledWith(ordinary.id);
    expect(host.disposeWebRuntime).toHaveBeenCalledWith(ordinary.id);
  });

  it.each([
    ['Mozilla/5.0 Edg/126.0.0.0', 'Edge'],
    ['Mozilla/5.0 Version/17.5 Safari/605.1.15', 'Safari'],
    ['arbitrary private browser details', 'Other'],
  ] as const)('projects %s to the safe browser family %s', (userAgent, family) => {
    const source = WebPrivilegedSession.safeSource(userAgent, 'not-an-ip');
    expect(source).toEqual({ browserFamily: family, addressLabel: 'LAN/VPN client' });
    expect(JSON.stringify(source)).not.toContain(userAgent);
  });
});
