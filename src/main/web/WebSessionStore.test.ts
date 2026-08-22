import { describe, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import type { PbAuthSession } from '@shared/ipc';
import { WebSessionStore } from './WebSessionStore';

const PB_URL = ['http', '://', 'relay-server', ':8090'].join('');
const PUBLIC_CONFIG = {
  mode: 'server' as const,
  port: 8090,
  bindHost: '0.0.0.0' as const,
  lanIp: ['192', '168', '1', '25'].join('.'),
  web: { enabled: true, port: 8091 },
};

function deterministicBytes() {
  let next = 1;
  return (size: number) => {
    const bytes = Buffer.alloc(size, next);
    next += 1;
    return bytes;
  };
}

function createStore(now: () => number) {
  return new WebSessionStore({ now, randomBytes: deterministicBytes() });
}

function createInput(overrides: Partial<{ refresh: () => Promise<PbAuthSession> }> = {}) {
  return {
    pbUrl: PB_URL,
    auth: { token: 'app-user-token', record: { id: 'relay-user' } },
    publicConfig: PUBLIC_CONFIG,
    runtime: WEB_RUNTIME,
    refresh: vi.fn(async () => ({ token: 'refreshed-token', record: { id: 'relay-user' } })),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('WebSessionStore', () => {
  it('creates opaque 256-bit session and CSRF values without accepting a passphrase', () => {
    const store = createStore(() => 1_000);
    const session = store.create(createInput());

    expect(Buffer.from(session.id, 'base64url')).toHaveLength(32);
    expect(Buffer.from(session.csrfToken, 'base64url')).toHaveLength(32);
    expect(session.id).not.toBe(session.csrfToken);
    expect(session.createdAt).toBe(1_000);
    expect(JSON.stringify(session)).not.toContain('passphrase');
  });

  it('expires after 60 idle minutes and runs every registered cleanup once', async () => {
    let now = 1_000;
    const store = createStore(() => now);
    const input = createInput();
    const cleanup = vi.fn(async () => undefined);
    const session = store.create(input);
    expect(store.registerCleanup(session.id, cleanup)).toBe(true);

    now += 60 * 60 * 1_000;
    expect(store.get(session.id)).toBeNull();
    await store.finishedDisposals();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it('touches activity without extending the eight-hour absolute lifetime', () => {
    let now = 10_000;
    const store = createStore(() => now);
    const session = store.create(createInput());

    for (let hour = 1; hour < 8; hour += 1) {
      now += 60 * 60 * 1_000 - 1;
      expect(store.get(session.id)).not.toBeNull();
    }
    now = 10_000 + 8 * 60 * 60 * 1_000;
    expect(store.get(session.id)).toBeNull();
  });

  it('rotates both identifiers on refresh while preserving the absolute start time', async () => {
    let now = 2_000;
    const store = createStore(() => now);
    const session = store.create(createInput());
    now = 3_000;

    const refreshed = await store.refresh(session.id);

    expect(refreshed).toMatchObject({
      auth: { token: 'refreshed-token' },
      createdAt: 2_000,
      lastActiveAt: 3_000,
    });
    expect(refreshed?.id).not.toBe(session.id);
    expect(refreshed?.csrfToken).not.toBe(session.csrfToken);
    expect(store.get(session.id)).toBeNull();
    expect(store.get(refreshed!.id, { touch: false })).not.toBeNull();
  });

  it('invalidates a session when its PocketBase refresh fails', async () => {
    const store = createStore(() => 4_000);
    const input = createInput({ refresh: vi.fn(async () => Promise.reject(new Error('expired'))) });
    const session = store.create(input);

    await expect(store.refresh(session.id)).resolves.toBeNull();
    await store.finishedDisposals();

    expect(store.get(session.id)).toBeNull();
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it('does not resurrect a session when destruction wins a pending refresh', async () => {
    let resolveRefresh!: (auth: PbAuthSession) => void;
    const refresh = vi.fn(
      () =>
        new Promise<PbAuthSession>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const store = createStore(() => 4_500);
    const input = createInput({ refresh });
    const session = store.create(input);

    const pending = store.refresh(session.id);
    expect(refresh).toHaveBeenCalledOnce();
    await store.destroy(session.id);
    resolveRefresh({ token: 'late-token', record: { id: 'relay-user' } });

    await expect(pending).resolves.toBeNull();
    expect(store.size).toBe(0);
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it('destroys the logical session when logout commits after cookie rotation', async () => {
    const store = createStore(() => 4_625);
    const input = createInput();
    const session = store.create(input);

    const refreshed = await store.refresh(session.id);
    expect(refreshed?.id).not.toBe(session.id);

    await store.destroyByRateLimitId(session.rateLimitId);

    expect(store.size).toBe(0);
    expect(store.get(refreshed!.id, { touch: false })).toBeNull();
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it('unregisters an old-cookie cleanup through the stable logical session after rotation', async () => {
    const store = createStore(() => 4_700);
    const input = createInput();
    const cleanup = vi.fn(async () => undefined);
    const session = store.create(input);
    expect(store.registerCleanup(session.id, cleanup)).toBe(true);

    const refreshed = await store.refresh(session.id);
    expect(refreshed).not.toBeNull();
    store.unregisterCleanupByRateLimitId(session.rateLimitId, cleanup);
    await store.destroy(refreshed!.id);

    expect(cleanup).not.toHaveBeenCalled();
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent refreshes into one rotation and one accepted key', async () => {
    let resolveRefresh!: (auth: PbAuthSession) => void;
    const refresh = vi.fn(
      () =>
        new Promise<PbAuthSession>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const store = createStore(() => 4_750);
    const session = store.create(createInput({ refresh }));

    const first = store.refresh(session.id);
    const second = store.refresh(session.id);
    expect(refresh).toHaveBeenCalledOnce();

    resolveRefresh({ token: 'coalesced-token', record: { id: 'relay-user' } });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult?.id).not.toBe(session.id);
    expect(store.size).toBe(1);
    expect(store.get(session.id, { touch: false })).toBeNull();
    expect(store.get(firstResult!.id, { touch: false })?.id).toBe(firstResult!.id);
  });

  it('disposes all sessions on server shutdown', async () => {
    const store = createStore(() => 5_000);
    const first = createInput();
    const second = createInput();
    store.create(first);
    store.create(second);

    await store.dispose();

    expect(store.size).toBe(0);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});
