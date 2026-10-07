import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdpBroker } from './SdpBroker';
import { SdpServerStore } from './SdpServerStore';
import { SdpProvider, SdpProviderError, SdpValidationError } from './SdpProvider';
const ticket = { number: '810129', status: 'Open', priority: 'Low', group: 'NOC' };
const client = { clientId: '1000.TEST', clientSecret: 'never-on-disk-plain' };
const cleanup: (() => void)[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'relay-sdp-broker-test-'));
  // Test key wrapping only: production uses OS safeStorage, never this adapter.
  const protection = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  };
  const store = new SdpServerStore(root, protection);
  store.save(client, 5, '');
  const provider = new SdpProvider();
  vi.spyOn(provider, 'token').mockResolvedValue({
    access_token: 'access-secret',
    refresh_token: 'refresh-secret',
    expires_in: 3600,
  });
  vi.spyOn(provider, 'identity').mockResolvedValue({
    id: '123',
    profile: { name: 'Example Person', email: 'person@example.test' },
  });
  vi.spyOn(provider, 'ticket').mockResolvedValue(ticket);
  vi.spyOn(provider, 'queue').mockImplementation(async (_token, _signal, queue, page) => ({
    queue,
    page,
    hasMore: true,
    tickets: [
      {
        id: '123456',
        number: '810129',
        subject: 'Synthetic queue subject',
        status: 'Open',
        priority: 'Low',
        group: queue,
        technician: 'Example technician',
        createdAt: 1000,
        dueAt: null,
      },
    ],
  }));
  vi.spyOn(provider, 'json').mockResolvedValue({ conversations: [] });
  const broker = new SdpBroker(store, provider);
  cleanup.push(() => {
    broker.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  return { broker, store, provider, root };
}
const state = 's'.repeat(43);
const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function signIn(broker: SdpBroker, id = 'alice') {
  await broker.invoke(id, { action: 'begin', state, challenge });
  return broker.invoke(id, { action: 'complete', state, verifier, code: 'one-use-code' });
}
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});
describe('SDP server broker and encrypted outage storage', () => {
  it('requests read-only setup access with ticket scopes through explicit OAuth consent', async () => {
    const { broker, provider } = setup();
    const result = await broker.invoke('alice', { action: 'begin', state, challenge });
    const authorization = new URL(result.authorizationUrl!);
    const scopes = authorization.searchParams.get('scope')!.split(',');
    expect(scopes).toContain('SDPOnDemand.setup.READ');
    expect(scopes.filter((s) => s.startsWith('SDPOnDemand.changes.'))).toEqual([
      'SDPOnDemand.changes.READ',
    ]);
    expect(scopes.filter((s) => s.startsWith('SDPOnDemand.setup.'))).toEqual([
      'SDPOnDemand.setup.READ',
    ]);
    expect(authorization.searchParams.get('prompt')).toBe('consent');
    expect(authorization.searchParams.get('code_challenge')).toBe(challenge);
    expect(provider.token).not.toHaveBeenCalled();
  });
  it('binds identity to Zoho and keeps credentials out of public replies and stored plaintext', async () => {
    // A fixed clock keeps the reply's timestamps from containing the identity ID by chance.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 0, 1) });
    const { broker, store, provider, root } = setup();
    expect((await signIn(broker)).view.status).toBe('connected');
    expect(provider.identity).toHaveBeenCalledWith('access-secret', expect.any(AbortSignal));
    const result = await broker.invoke('alice', { action: 'readTestTicket' });
    expect(result.view.ticket).toEqual(ticket);
    expect(result.view.snapshot?.source).toBe('live');
    for (const secret of ['access-secret', 'refresh-secret', client.clientSecret, '123'])
      expect(JSON.stringify(result)).not.toContain(secret);
    expect(
      readFileSync(join(root, 'connection.enc')).includes(Buffer.from(client.clientSecret)),
    ).toBe(false);
    expect(readFileSync(join(root, 'outage-cache.sqlite')).includes(Buffer.from('NOC'))).toBe(
      false,
    );
    expect(store.get(store.owner('123', store.settings()!.revision))?.ticket).toEqual(ticket);
  });
  it('shows the Zoho name and email only to the person who signed in, and never stores them', async () => {
    const { broker, provider, root } = setup();
    const signedIn = await signIn(broker);
    expect(signedIn.view.account).toBeUndefined();
    expect((await broker.invoke('alice', { action: 'readAccount' })).view.account).toEqual({
      name: 'Example Person',
      email: 'person@example.test',
    });
    vi.mocked(provider.identity).mockResolvedValue({ id: '456' });
    await signIn(broker, 'bob');
    expect((await broker.invoke('bob', { action: 'readAccount' })).view.account).toBeUndefined();
    await expect(broker.invoke('carol', { action: 'readAccount' })).rejects.toThrow(
      'Sign in to SDP first.',
    );
    await broker.invoke('alice', { action: 'readTestTicket' });
    for (const file of ['connection.enc', 'outage-cache.sqlite'])
      expect(readFileSync(join(root, file)).includes(Buffer.from('Example Person'))).toBe(false);
  });
  it('keeps the sign-in connected when SDP does not offer Pick Up on a ticket', async () => {
    const { broker, provider } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 1 });
    vi.mocked(provider.json).mockImplementation(async (url) =>
      String(url).endsWith('/_links') ? { _links: [] } : { request: { id: '123456' } },
    );
    const reply = await broker.invoke('alice', {
      action: 'prepareChange',
      mutation: { kind: 'pickup', id: '123456' },
    });
    expect(reply.view.status).toBe('connected');
    expect(reply.view.review).toBeUndefined();
    expect(reply.view.message).toContain('SDP does not offer Pick Up on this ticket.');
  });
  it('detects swapped ciphertext and refuses plaintext storage when OS protection is unavailable', async () => {
    const { broker, store, root } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readTestTicket' });
    const owner = store.owner('123', store.settings()!.revision);
    const other = store.owner('456', store.settings()!.revision);
    const db = new Database(join(root, 'outage-cache.sqlite'));
    try {
      db.prepare('UPDATE snapshots SET owner = ? WHERE owner = ?').run(other, owner);
    } finally {
      db.close();
    }
    expect(store.get(other)).toBeNull();
    expect(
      () =>
        new SdpServerStore(join(root, 'unprotected'), {
          isEncryptionAvailable: () => false,
          encryptString: () => Buffer.alloc(0),
          decryptString: () => '',
        }),
    ).toThrow('OS-protected');
  });
  it('uses saved copies only for the same verified identity during an upstream outage', async () => {
    const { broker, provider } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readTestTicket' });
    vi.mocked(provider.identity).mockResolvedValue({ id: '456' });
    await signIn(broker, 'bob');
    vi.mocked(provider.ticket).mockRejectedValue(new SdpProviderError('outage'));
    expect((await broker.invoke('alice', { action: 'readTestTicket' })).view.snapshot?.source).toBe(
      'outage-cache',
    );
    expect((await broker.invoke('bob', { action: 'readTestTicket' })).view.ticket).toBeUndefined();
    expect((await broker.invoke('unknown', { action: 'status' })).view.ticket).toBeUndefined();
  });
  it.each(['denied', 'invalid'] as const)(
    'never falls back on %s responses and removes previous copies',
    async (kind) => {
      const { broker, provider, store } = setup();
      await signIn(broker);
      await broker.invoke('alice', { action: 'readTestTicket' });
      vi.mocked(provider.ticket).mockRejectedValue(new SdpProviderError(kind));
      expect(
        (await broker.invoke('alice', { action: 'readTestTicket' })).view.ticket,
      ).toBeUndefined();
      expect(store.get(store.owner('123', store.settings()!.revision))).toBeNull();
    },
  );
  it('expires saved copies and active sessions without needing an upstream response', async () => {
    vi.useFakeTimers();
    const { broker, provider } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readTestTicket' });
    vi.advanceTimersByTime(300_001);
    expect((await broker.invoke('alice', { action: 'status' })).view.ticket).toBeUndefined();
    vi.mocked(provider.ticket).mockRejectedValue(new SdpProviderError('outage'));
    expect(
      (await broker.invoke('alice', { action: 'readTestTicket' })).view.ticket,
    ).toBeUndefined();
    vi.advanceTimersByTime(8 * 3600_000);
    expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('disconnected');
  });
  it('rejects cross-session, wrong-proof and replayed callback codes before token exchange', async () => {
    const { broker, provider } = setup();
    await broker.invoke('alice', { action: 'begin', state, challenge });
    await expect(
      broker.invoke('bob', { action: 'complete', state, verifier, code: 'code' }),
    ).rejects.toThrow();
    await expect(
      broker.invoke('alice', { action: 'complete', state, verifier: 'x'.repeat(43), code: 'code' }),
    ).rejects.toThrow();
    expect(provider.token).not.toHaveBeenCalled();
    await signIn(broker);
    await expect(
      broker.invoke('alice', { action: 'complete', state, verifier, code: 'code' }),
    ).rejects.toThrow();
    expect(provider.token).toHaveBeenCalledTimes(1);
  });
  it('does not revive disconnected sessions or store an in-flight read after cancellation', async () => {
    const { broker, provider, store } = setup();
    await signIn(broker);
    let resolve!: (value: typeof ticket) => void;
    vi.mocked(provider.ticket).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const read = broker.invoke('alice', { action: 'readTestTicket' });
    await vi.waitFor(() => expect(provider.ticket).toHaveBeenCalled());
    broker.disconnect('alice');
    resolve(ticket);
    await expect(read).rejects.toThrow();
    expect(store.get(store.owner('123', store.settings()!.revision))).toBeNull();
  });
  it('invalidates other sessions of the same identity on denied access', async () => {
    const { broker, provider } = setup();
    await signIn(broker);
    await signIn(broker, 'alice-second');
    await broker.invoke('alice-second', { action: 'readTestTicket' });
    vi.mocked(provider.ticket).mockRejectedValue(new SdpProviderError('denied'));
    await broker.invoke('alice', { action: 'readTestTicket' });
    expect((await broker.invoke('alice-second', { action: 'status' })).view.status).toBe(
      'disconnected',
    );
  });
  it('refreshes as the individual user and never uses cached data after failed refresh', async () => {
    vi.useFakeTimers();
    const { broker, provider, store } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readTestTicket' });
    vi.advanceTimersByTime(3580_000);
    await broker.invoke('alice', { action: 'readTestTicket' });
    const body = vi.mocked(provider.token).mock.calls[1]![0] as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-secret');
    vi.advanceTimersByTime(3500_000);
    await broker.invoke('alice', { action: 'readTestTicket' });
    vi.advanceTimersByTime(80_000);
    const owner = store.owner('123', store.settings()!.revision);
    // An outage during renewal keeps the sign-in and saved copy but never serves that copy.
    vi.mocked(provider.token).mockRejectedValue(new SdpProviderError('outage'));
    vi.mocked(provider.ticket).mockRejectedValue(new SdpProviderError('outage'));
    const outage = await broker.invoke('alice', { action: 'readTestTicket' });
    expect(outage.view.status).toBe('connected');
    expect(outage.view.ticket).toBeUndefined();
    expect(outage.view.snapshot).toBeUndefined();
    expect(store.get(owner)).not.toBeNull();
    // A refused renewal revokes the sign-in and purges the copy.
    vi.mocked(provider.token).mockResolvedValue({ error: 'invalid_grant' });
    expect((await broker.invoke('alice', { action: 'readTestTicket' })).view.status).toBe(
      'expired',
    );
    expect(store.get(owner)).toBeNull();
  });
  it('isolates cached queue pages by queue, page, and verified identity', async () => {
    const { broker, provider, store } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    vi.mocked(provider.identity).mockResolvedValue({ id: '456' });
    await signIn(broker, 'bob');
    vi.mocked(provider.queue).mockRejectedValue(new SdpProviderError('outage'));
    expect(
      (await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 })).view.snapshot
        ?.source,
    ).toBe('outage-cache');
    for (const [id, queue, page] of [
      ['alice', 'SOX', 0],
      ['alice', 'NOC', 1],
      ['bob', 'NOC', 0],
    ] as const)
      expect(
        (await broker.invoke(id, { action: 'readQueue', queue, page })).view.queuePage,
      ).toBeUndefined();
    const owner = store.owner('123', store.settings()!.revision);
    expect(store.getQueue(owner, 'NOC', 0)?.queuePage.tickets[0]?.subject).toBe(
      'Synthetic queue subject',
    );
  });
  it('clears all copies and projections for one identity while preserving another user and sign-in', async () => {
    const { broker, provider, store, root } = setup();
    await signIn(broker);
    await signIn(broker, 'alice-second');
    await broker.invoke('alice', { action: 'readTestTicket' });
    await broker.invoke('alice-second', { action: 'readQueue', queue: 'NOC', page: 0 });
    vi.mocked(provider.identity).mockResolvedValue({ id: '456' });
    await signIn(broker, 'bob');
    await broker.invoke('bob', { action: 'readQueue', queue: 'SOX', page: 0 });
    expect(
      readFileSync(join(root, 'outage-cache.sqlite')).includes(
        Buffer.from('Synthetic queue subject'),
      ),
    ).toBe(false);
    await broker.invoke('alice', { action: 'clearCopies' });
    const owner = store.owner('123', store.settings()!.revision);
    expect(store.get(owner)).toBeNull();
    expect(store.getQueue(owner, 'NOC', 0)).toBeNull();
    expect((await broker.invoke('alice-second', { action: 'status' })).view).toMatchObject({
      status: 'connected',
    });
    expect(
      (await broker.invoke('alice-second', { action: 'status' })).view.queuePage,
    ).toBeUndefined();
    expect((await broker.invoke('bob', { action: 'status' })).view.queuePage?.queue).toBe('SOX');
  });
  it('does not repopulate cleared data from an in-flight queue request', async () => {
    const { broker, provider, store } = setup();
    await signIn(broker);
    const fixture = { queue: 'NOC' as const, page: 0, hasMore: false, tickets: [] };
    let complete!: (value: typeof fixture) => void;
    vi.mocked(provider.queue).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const read = broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    await vi.waitFor(() => expect(provider.queue).toHaveBeenCalled());
    await broker.invoke('alice', { action: 'clearCopies' });
    complete(fixture);
    await expect(read).rejects.toThrow('Connection ended');
    expect(store.getQueue(store.owner('123', store.settings()!.revision), 'NOC', 0)).toBeNull();
  });
  it('purges every saved queue page after a permission denial', async () => {
    const { broker, provider, store } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    vi.mocked(provider.queue).mockRejectedValue(new SdpProviderError('denied'));
    expect(
      (await broker.invoke('alice', { action: 'readQueue', queue: 'SOX', page: 0 })).view.status,
    ).toBe('expired');
    expect(store.getQueue(store.owner('123', store.settings()!.revision), 'NOC', 0)).toBeNull();
  });
  it('rejects stale settings updates and invalidates sessions and snapshots after replacement', async () => {
    const { broker, store } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readTestTicket' });
    const old = store.settings()!;
    expect(() => store.save(client, 5, 'stale')).toThrow();
    store.save(client, 10, old.revision);
    expect(store.get(store.owner('123', old.revision))).toBeNull();
    expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('disconnected');
  });
});

it('restricts detail reads to the current queue, isolates saved details and purges them on clear', async () => {
  const { broker, provider, store, root } = setup();
  const detail = {
    id: '123456',
    page: 0,
    description: 'Private synthetic description',
    conversations: [],
    hasMore: false,
  };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  await signIn(broker);
  await expect(
    broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 }),
  ).rejects.toThrow('Load the ticket queue');
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  expect(
    (await broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 })).view.detail,
  ).toEqual(detail);
  const owner = store.owner('123', store.settings()!.revision);
  expect(store.getDetail(owner, detail.id, 0)?.detail).toEqual(detail);
  expect(store.getDetail('other-owner', detail.id, 0)).toBeNull();
  expect(store.getDetail(owner, detail.id, 1)).toBeNull();
  expect(
    readFileSync(join(root, 'outage-cache.sqlite')).includes(Buffer.from(detail.description)),
  ).toBe(false);
  vi.mocked(provider.detail).mockRejectedValue(new SdpProviderError('outage'));
  expect(
    (await broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 })).view
      .detailSnapshot?.source,
  ).toBe('outage-cache');
  await broker.invoke('alice', { action: 'clearCopies' });
  expect(store.getDetail(owner, detail.id, 0)).toBeNull();
  expect((await broker.invoke('alice', { action: 'status' })).view.detail).toBeUndefined();
});

it('reports a deleted or restricted ticket without signing the identity out', async () => {
  const { broker, provider, store } = setup();
  const detail = { id: '123456', page: 0, description: 'd', conversations: [], hasMore: false };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  await signIn(broker);
  await signIn(broker, 'alice-laptop');
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  await broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 });
  const owner = store.owner('123', store.settings()!.revision);
  vi.mocked(provider.detail).mockRejectedValue(new SdpProviderError('denied', 0, 'http', 404));
  const missing = await broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 });
  expect(missing.view.status).toBe('connected');
  expect(missing.view.detail).toBeUndefined();
  expect(missing.view.message).toMatch('could not find this item');
  expect((await broker.invoke('alice-laptop', { action: 'status' })).view.status).toBe('connected');
  expect(store.getQueue(owner, 'NOC', 0)).not.toBeNull();
  vi.mocked(provider.detail).mockRejectedValue(new SdpProviderError('denied', 0, 'http', 403));
  const restricted = await broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 });
  expect(restricted.view.status).toBe('connected');
  expect((await broker.invoke('alice-laptop', { action: 'status' })).view.status).toBe('connected');
  expect(store.getQueue(owner, 'NOC', 0)).toBeNull();
  vi.mocked(provider.detail).mockRejectedValue(new SdpProviderError('denied', 0, 'http', 401));
  const revoked = await broker.invoke('alice', { action: 'readDetail', id: detail.id, page: 0 });
  expect(revoked.view.status).toBe('expired');
  expect((await broker.invoke('alice-laptop', { action: 'status' })).view.status).toBe(
    'disconnected',
  );
});

describe('SDP confirmed changes', () => {
  it('requires a session-bound one-use review before a live write and purges stale copies', async () => {
    const { broker, provider, store } = setup();
    await signIn(broker);
    await signIn(broker, 'bob');
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    const json = vi
      .spyOn(provider, 'json')
      .mockResolvedValue({ request: { id: '123456', subject: 'Original' } });
    json.mockClear();
    const prepared = await broker.invoke('alice', {
      action: 'prepareChange',
      mutation: { kind: 'update', id: '123456', fields: { status: 'In progress' } },
    });
    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0]![2]?.method).toBeUndefined();
    const confirmationId = prepared.view.review!.confirmationId;
    await expect(
      broker.invoke('bob', { action: 'confirmChange', confirmationId }),
    ).rejects.toThrow();
    const owner = store.owner('123', store.settings()!.revision);
    let savedDuringWrite: unknown;
    json
      .mockResolvedValueOnce({ request: { id: '123456', subject: 'Original' } })
      .mockImplementationOnce(async () => {
        savedDuringWrite = store.getQueue(owner, 'NOC', 0);
        return {
          response_status: { status_code: 2000 },
          request: { id: '123456', display_id: '810129' },
        };
      });
    const result = await broker.invoke('alice', { action: 'confirmChange', confirmationId });
    expect(result.view.changeResult?.id).toBe('123456');
    expect(json.mock.calls.at(-1)?.[2]?.method).toBe('PUT');
    // Stale copies are purged before the write; only the post-write re-read saves a fresh one.
    expect(savedDuringWrite).toBeNull();
    expect(store.getQueue(owner, 'NOC', 0)).toMatchObject({
      fetchedAt: result.view.snapshot!.fetchedAt,
    });
    await expect(
      broker.invoke('alice', { action: 'confirmChange', confirmationId }),
    ).rejects.toThrow();
    expect(json).toHaveBeenCalledTimes(3);
  });
  it('re-reads the visible filtered queue page and open ticket after a confirmed or rejected write', async () => {
    const { broker, provider } = setup();
    await signIn(broker);
    const filters = { status: ['On Hold', 'Open'] };
    vi.mocked(provider.queue).mockImplementation(
      async (_token, _signal, queue, page, _since, requested) => ({
        queue,
        page,
        hasMore: false,
        ...(requested ? { filters: requested } : {}),
        tickets: [
          {
            id: '123456',
            number: '810129',
            subject: 'Synthetic queue subject',
            status: 'Open',
            priority: 'Low',
            group: queue,
            technician: 'Example technician',
            createdAt: 1000,
            dueAt: null,
          },
        ],
      }),
    );
    const detail = {
      id: '123456',
      page: 0,
      includeAutoNotifications: false,
      description: 'Before',
      conversations: [],
      hasMore: false,
    };
    vi.spyOn(provider, 'detail').mockResolvedValue(detail);
    await broker.invoke('alice', { action: 'readQueue', queue: 'SOX', page: 0, filters });
    await broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
    const json = vi
      .spyOn(provider, 'json')
      .mockResolvedValue({ request: { id: '123456', subject: 'Original' } });
    const confirm = async (rejection?: Error) => {
      const prepared = await broker.invoke('alice', {
        action: 'prepareChange',
        mutation: { kind: 'update', id: '123456', fields: { status: 'On Hold' } },
      });
      json.mockResolvedValueOnce({ request: { id: '123456', subject: 'Original' } });
      if (rejection) json.mockRejectedValueOnce(rejection);
      else
        json.mockResolvedValueOnce({
          response_status: { status_code: 2000 },
          request: { id: '123456', display_id: '810129' },
        });
      return broker.invoke('alice', {
        action: 'confirmChange',
        confirmationId: prepared.view.review!.confirmationId,
      });
    };
    vi.mocked(provider.detail).mockResolvedValue({ ...detail, description: 'After' });
    const result = await confirm();
    expect(result.view).toMatchObject({
      changeResult: { id: '123456' },
      message: 'Change confirmed by SDP.',
      queuePage: { queue: 'SOX', page: 0, filters },
      detail: { id: '123456', description: 'After' },
      detailSnapshot: { source: 'live' },
    });
    expect(provider.queue).toHaveBeenLastCalledWith(
      'access-secret',
      expect.any(AbortSignal),
      'SOX',
      0,
      undefined,
      filters,
      undefined,
      undefined,
    );

    // A rejected write changes nothing, and the queue and ticket stay on screen beside the reason.
    const rejected = await confirm(new SdpValidationError(['request_type']));
    expect(rejected.view.changeResult).toBeUndefined();
    expect(rejected.view).toMatchObject({
      message:
        'SDP rejected the change. Check these fields: request_type. Refresh the ticket before preparing a new change.',
      queuePage: { queue: 'SOX', page: 0, filters },
      detail: { id: '123456' },
    });

    // A failed re-read keeps the confirmed result and asks for a manual refresh instead.
    vi.mocked(provider.queue).mockRejectedValueOnce(new SdpProviderError('outage'));
    const fallback = await confirm();
    expect(fallback.view.changeResult?.id).toBe('123456');
    expect(fallback.view.queuePage).toBeUndefined();
    expect(fallback.view.message).toBe(
      'Change confirmed by SDP. Refresh the queue to see current values.',
    );
  });
  it('refuses changed records, expired reviews, unlisted tickets and uncertain replays', async () => {
    const { broker, provider } = setup();
    await signIn(broker);
    const mutation = { kind: 'update', id: '123456', fields: { priority: 'High' } } as const;
    await expect(broker.invoke('alice', { action: 'prepareChange', mutation })).rejects.toThrow();
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    const json = vi
      .spyOn(provider, 'json')
      .mockResolvedValue({ request: { id: '123456', subject: 'Original' } });
    const first = await broker.invoke('alice', { action: 'prepareChange', mutation });
    json.mockResolvedValueOnce({ request: { id: '123456', subject: 'Changed elsewhere' } });
    expect(
      (
        await broker.invoke('alice', {
          action: 'confirmChange',
          confirmationId: first.view.review!.confirmationId,
        })
      ).view.message,
    ).toContain('changed in SDP');
    const second = await broker.invoke('alice', { action: 'prepareChange', mutation });
    vi.spyOn(Date, 'now').mockReturnValue(second.view.review!.expiresAt + 1);
    await expect(
      broker.invoke('alice', {
        action: 'confirmChange',
        confirmationId: second.view.review!.confirmationId,
      }),
    ).rejects.toThrow();
    vi.restoreAllMocks();
    expect(json.mock.calls.every((call) => !call[2]?.method)).toBe(true);
  });
  it('does not replay a create after an ambiguous result', async () => {
    const { broker, provider } = setup();
    await signIn(broker);
    const json = vi
      .spyOn(provider, 'json')
      .mockRejectedValue(new Error('private provider response'));
    const prepared = await broker.invoke('alice', {
      action: 'prepareChange',
      mutation: { kind: 'create', fields: { subject: 'Synthetic incident' }, majorIncident: true },
    });
    const command = {
      action: 'confirmChange',
      confirmationId: prepared.view.review!.confirmationId,
    } as const;
    const result = await broker.invoke('alice', command);
    expect(result.view.changeResult).toBeUndefined();
    expect(result.view.message).toContain('will not retry');
    expect(JSON.stringify(result)).not.toContain('private provider');
    await expect(broker.invoke('alice', command)).rejects.toThrow();
    expect(json).toHaveBeenCalledTimes(1);
  });
  it('serves shared background snapshots without repeating provider scans for heartbeats', async () => {
    vi.useFakeTimers();
    const { broker, provider } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    vi.mocked(provider.queue).mockImplementation(async (_token, _signal, queue, page) => ({
      queue,
      page,
      hasMore: false,
      tickets: [],
    }));
    await broker.invoke('alice', { action: 'monitorQueues' });
    await vi.advanceTimersByTimeAsync(0);
    const result = await broker.invoke('alice', { action: 'monitorQueues' });
    expect(result.view.monitor).toMatchObject({ tickets: [], truncated: false });
    expect((await broker.invoke('alice', { action: 'status' })).view.queuePage?.queue).toBe('NOC');
    expect((await broker.invoke('alice', { action: 'status' })).view.monitor).toBeUndefined();
    const calls = vi.mocked(provider.queue).mock.calls.length;
    await broker.invoke('alice', {
      action: 'monitorQueues',
      after: result.view.monitor!.fetchedAt,
    });
    expect(provider.queue).toHaveBeenCalledTimes(calls);
  });
});

it('revokes the session on a denied write without keeping stale ticket projections', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const json = vi.spyOn(provider, 'json').mockResolvedValue({ request: { id: '123456' } });
  const prepared = await broker.invoke('alice', {
    action: 'prepareChange',
    mutation: { kind: 'update', id: '123456', fields: { status: 'Resolved' } },
  });
  json
    .mockResolvedValueOnce({ request: { id: '123456' } })
    .mockRejectedValueOnce(new SdpProviderError('denied'));
  await expect(
    broker.invoke('alice', {
      action: 'confirmChange',
      confirmationId: prepared.view.review!.confirmationId,
    }),
  ).rejects.toThrow();
  const result = await broker.invoke('alice', { action: 'status' });
  expect(result.view.status).toBe('disconnected');
  expect(result.view.queuePage).toBeUndefined();
});

it('checks child resources again before confirming, including edits that do not change the parent', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  let title = 'Original task';
  const json = vi
    .spyOn(provider, 'json')
    .mockImplementation(async (url) =>
      url.endsWith('/tasks/4') ? { task: { id: '4', title } } : { request: { id: '123456' } },
    );
  const first = await broker.invoke('alice', {
    action: 'prepareChange',
    mutation: {
      kind: 'resource',
      id: '123456',
      resource: 'tasks',
      recordId: '4',
      operation: 'update',
      fields: { title: 'My edit' },
    },
  });
  title = 'Edited elsewhere';
  const result = await broker.invoke('alice', {
    action: 'confirmChange',
    confirmationId: first.view.review!.confirmationId,
  });
  expect(result.view.message).toContain('changed in SDP');
  expect(json.mock.calls.every((call) => !call[2]?.method)).toBe(true);
});

it('redacts upload bytes from reviews and status but sends the original file only after confirmation', async () => {
  const { broker, provider, root } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const json = vi.spyOn(provider, 'json').mockResolvedValue({ request: { id: '123456' } });
  const data = Buffer.from('private test attachment bytes').toString('base64');
  const prepared = await broker.invoke('alice', {
    action: 'prepareChange',
    mutation: {
      kind: 'attachment',
      id: '123456',
      name: 'example.txt',
      contentType: 'text/plain',
      data,
    },
  });
  expect(JSON.stringify(prepared)).not.toContain(data);
  expect(JSON.stringify(await broker.invoke('alice', { action: 'status' }))).not.toContain(data);
  expect(readFileSync(join(root, 'outage-cache.sqlite')).includes(Buffer.from(data))).toBe(false);
  json
    .mockResolvedValueOnce({ request: { id: '123456' } })
    .mockResolvedValueOnce({ response_status: { status_code: 2000 } });
  const command = {
    action: 'confirmChange',
    confirmationId: prepared.view.review!.confirmationId,
  } as const;
  expect((await broker.invoke('alice', command)).view.changeResult?.kind).toBe('attachment');
  const form = json.mock.calls.at(-1)![2]!.body as FormData;
  expect(await (form.get('filename') as Blob).text()).toBe('private test attachment bytes');
  await expect(broker.invoke('alice', command)).rejects.toThrow();
  expect(json.mock.calls.filter((call) => call[2]?.method === 'POST')).toHaveLength(1);
});

it('continues polling during a detail read, keeps its open detail, and shares work across the same identity', async () => {
  vi.useFakeTimers();
  const { broker, provider } = setup();
  await signIn(broker);
  await signIn(broker, 'peer');
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  let finish!: (value: import('@shared/sdpAccount').SdpDetail) => void;
  vi.spyOn(provider, 'detail').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const detailRead = broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
  await vi.advanceTimersByTimeAsync(0);
  vi.mocked(provider.queue)
    .mockClear()
    .mockImplementation(async (_token, _signal, queue, page) => ({
      queue,
      page,
      hasMore: false,
      tickets: [],
    }));
  await broker.invoke('alice', { action: 'monitorQueues' });
  await broker.invoke('peer', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  expect(provider.queue).toHaveBeenCalledTimes(3);
  const detail = {
    id: '123456',
    description: 'Dummy detail',
    page: 0,
    hasMore: false,
    conversations: [],
  };
  finish(detail);
  await detailRead;
  await vi.advanceTimersByTimeAsync(30000);
  expect(provider.queue).toHaveBeenCalledTimes(6);
  expect((await broker.invoke('alice', { action: 'status' })).view.detail).toEqual(detail);
  expect((await broker.invoke('alice', { action: 'status' })).view.queuePage?.tickets).toEqual([]);
});
it('cancels a background scan when saved copies are cleared and ignores its late completion', async () => {
  vi.useFakeTimers();
  const { broker, provider } = setup();
  await signIn(broker);
  let finish!: (value: import('@shared/sdpAccount').SdpQueuePage) => void;
  vi.mocked(provider.queue).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  await broker.invoke('alice', { action: 'clearCopies' });
  finish({ queue: 'NOC', page: 0, hasMore: false, tickets: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect((await broker.invoke('alice', { action: 'status' })).view.queuePage).toBeUndefined();
});
it('deduplicates token refresh when queue polling overlaps an interactive read', async () => {
  vi.useFakeTimers();
  const { broker, provider } = setup();
  await signIn(broker);
  vi.advanceTimersByTime(3580000);
  const read = broker.invoke('alice', { action: 'readTestTicket' });
  await broker.invoke('alice', { action: 'monitorQueues' });
  await read;
  await vi.advanceTimersByTimeAsync(0);
  expect(provider.token).toHaveBeenCalledTimes(2);
});
it('suspends monitoring during a confirmed write and resumes with a fresh baseline', async () => {
  vi.useFakeTimers();
  const { broker, provider } = setup();
  await signIn(broker);
  vi.mocked(provider.queue).mockImplementation(async (_token, _signal, queue, page) => ({
    queue,
    page,
    hasMore: false,
    tickets: [],
  }));
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  const before = await broker.invoke('alice', { action: 'monitorQueues' });
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  let finish!: (value: unknown) => void;
  vi.spyOn(provider, 'json').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const prepared = await broker.invoke('alice', {
    action: 'prepareChange',
    mutation: { kind: 'create', fields: { subject: 'Dummy' }, majorIncident: false },
  });
  const saving = broker.invoke('alice', {
    action: 'confirmChange',
    confirmationId: prepared.view.review!.confirmationId,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect((await broker.invoke('alice', { action: 'monitorQueues' })).view.monitoring?.state).toBe(
    'off',
  );
  await vi.advanceTimersByTimeAsync(30000);
  expect(provider.queue).toHaveBeenCalledTimes(4);
  finish({ response_status: { status_code: 2000 }, request: { id: '999', display_id: '810130' } });
  expect((await saving).view.changeResult?.id).toBe('999');
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  expect(
    (await broker.invoke('alice', { action: 'monitorQueues' })).view.monitor?.generation,
  ).not.toBe(before.view.monitor?.generation);
  // The page on screen is read again after the write, then monitoring takes a fresh baseline.
  expect(provider.queue).toHaveBeenCalledTimes(8);
});

it('does not restore an unfiltered outage cache for a filtered queue request', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  vi.mocked(provider.queue).mockRejectedValue(new SdpProviderError('outage'));
  const result = await broker.invoke('alice', {
    action: 'readQueue',
    queue: 'NOC',
    page: 0,
    filters: { status: 'Closed' },
  });
  expect(result.view.queuePage).toBeUndefined();
  expect(result.view.snapshot).toBeUndefined();
  expect(result.view.message).toContain('Filtered results require a live connection');
});
it('requires an authorized live ticket before form, dropdown or reply reads', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  const json = vi.spyOn(provider, 'json');
  for (const command of [
    { action: 'readForm', id: '123456' },
    { action: 'readReplyContext', id: '123456' },
    { action: 'readTicketRelations', id: '123456', page: 0 },
    { action: 'readOptions', id: '123456', field: 'group', dependencies: {}, search: '', page: 0 },
  ] as const)
    await expect(broker.invoke('alice', command)).rejects.toThrow('Load a live ticket first');
  expect(json).not.toHaveBeenCalled();
});
it('runs a ticket panel read after the one before it instead of rejecting it', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  let finish!: (value: unknown) => void;
  const history = { history: [], list_info: { has_more_rows: false } };
  const historyReads: string[] = [];
  vi.spyOn(provider, 'json').mockImplementation(async (url) => {
    if (!url.includes('/_history')) return { conversations: [] };
    historyReads.push(url);
    if (historyReads.length > 1) return history;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const read = (page: number) =>
    broker.invoke('alice', { action: 'readHistory', id: '123456', page });
  const first = read(0);
  const waiting = Array.from({ length: 8 }, (_, index) => read(index + 1));
  await expect(read(9)).rejects.toThrow('An SDP operation is already in progress.');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(historyReads).toHaveLength(1);
  finish(history);
  const pages = (await Promise.all([first, ...waiting])).map((reply) => reply.view.history?.page);
  expect(pages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(historyReads).toHaveLength(9);
  expect((await read(0)).view.history?.page).toBe(0);
});
it.each([401, 403, 404])(
  'keeps live ticket data and the session when editor metadata returns HTTP %s but ticket access is valid',
  async (status) => {
    const { broker, provider } = setup();
    await signIn(broker);
    const queue = await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    vi.spyOn(provider, 'detail').mockResolvedValue({
      id: '123456',
      description: 'Saved description',
      page: 0,
      hasMore: false,
      conversations: [],
    });
    await broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
    vi.mocked(provider.json).mockImplementation(async (url) => {
      if (url.endsWith('/123456')) return { request: { id: '123456', template: { id: '7' } } };
      throw new SdpProviderError('denied', 0, 'http', status);
    });
    const form = await broker.invoke('alice', { action: 'readForm', id: '123456' });
    expect(form.view.status).toBe('connected');
    expect(form.view.message).toContain('Your account is still connected');
    expect(form.view.queuePage).toEqual(queue.view.queuePage);
    expect(form.view.detail?.description).toBe('Saved description');
    expect(form.view.form).toBeUndefined();
    expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('connected');
  },
);
it('still revokes the account when the live ticket recheck also denies access', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  vi.mocked(provider.json).mockRejectedValue(new SdpProviderError('denied', 0, 'http', 401));
  await expect(broker.invoke('alice', { action: 'readForm', id: '123456' })).rejects.toMatchObject({
    kind: 'denied',
  });
  const status = await broker.invoke('alice', { action: 'status' });
  expect(status.view.status).toBe('disconnected');
  expect(status.view.queuePage).toBeUndefined();
});
it('delivers reply metadata across the strict gateway contract and marks read only when the latest message is loaded', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  const { SdpBrokerReplySchema } = await import('@shared/sdpAccount');
  const feed = (id: string) => ({
    conversations: [
      {
        id,
        type: 'REQREPLY',
        created_by: { name: 'Example requester', is_technician: false },
        created_time: { value: '1000' },
      },
    ],
  });
  vi.mocked(provider.json).mockResolvedValue(feed('10'));
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  vi.mocked(provider.json).mockResolvedValue(feed('11'));
  const detail = {
    id: '123456',
    description: 'Dummy',
    page: 0,
    hasMore: false,
    conversations: [] as {
      id: string;
      author: string;
      subject: string;
      body: string;
      createdAt: number;
    }[],
  };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  let result = await broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
  expect(SdpBrokerReplySchema.parse(result).view.replyActivity).toMatchObject({
    lastReply: { id: '11', author: 'Example requester' },
    replyUnread: true,
  });
  vi.mocked(provider.detail).mockResolvedValue({
    ...detail,
    conversations: [
      {
        id: '11',
        author: 'Example requester',
        subject: 'Dummy',
        body: 'Dummy body',
        createdAt: 1000,
      },
    ],
  });
  result = await broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
  expect(result.view.replyActivity?.replyUnread).toBe(false);
  expect(result.view.queuePage?.tickets[0]?.replyUnread).toBe(false);
  await broker.invoke('alice', { action: 'clearCopies' });
  expect((await broker.invoke('alice', { action: 'status' })).view.replyActivity).toBeUndefined();
  expect(provider.json).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ method: 'PUT' }),
  );
});

it('checks replies for a row that arrives on an automatic refresh', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const arrived = {
    id: '654321',
    number: '810130',
    subject: 'Synthetic arrival',
    status: 'Open',
    priority: 'Low',
    group: 'NOC',
    technician: 'Example technician',
    createdAt: 2000,
    dueAt: null,
  };
  vi.mocked(provider.queue).mockResolvedValue({
    queue: 'NOC',
    page: 0,
    hasMore: false,
    tickets: [arrived],
  });
  vi.mocked(provider.json).mockResolvedValue({
    conversations: [
      {
        id: '12',
        type: 'REQREPLY',
        created_by: { name: 'Example requester', is_technician: false },
        created_time: { value: '1000' },
      },
    ],
  });
  const fresh = await broker.invoke('alice', { action: 'refreshVisible' });
  expect(fresh.view.queuePage?.tickets[0]).toMatchObject({
    id: '654321',
    lastReply: { id: '12', author: 'Example requester' },
    replyState: 'ready',
  });
});

it('reads a sorted page live, refreshes it in the same order, and never saves it as the outage copy', async () => {
  const { broker, provider, store } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const owner = store.owner('123', store.settings()!.revision);
  const saved = store.getQueue(owner, 'NOC', 0)!.queuePage;
  const sort = { field: 'status', order: 'desc' } as const;
  // The provider echoes a chosen order on the page, as SdpProvider.queue does.
  const read = vi.mocked(provider.queue).getMockImplementation()!;
  vi.mocked(provider.queue).mockImplementation(async (...args) => ({
    ...(await read(...args)),
    ...(args[7] ? { sort: args[7] } : {}),
  }));
  const sorted = await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0, sort });
  expect(provider.queue).toHaveBeenLastCalledWith(
    'access-secret',
    expect.any(AbortSignal),
    'NOC',
    0,
    undefined,
    undefined,
    undefined,
    sort,
  );
  expect(sorted.view.queuePage?.sort).toEqual(sort);
  expect(store.getQueue(owner, 'NOC', 0)!.queuePage).toEqual(saved);
  await broker.invoke('alice', { action: 'refreshVisible' });
  expect(vi.mocked(provider.queue).mock.lastCall?.[7]).toEqual(sort);
  vi.mocked(provider.queue).mockRejectedValue(new SdpProviderError('outage'));
  const outage = await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0, sort });
  expect(outage.view.queuePage).toBeUndefined();
  expect(outage.view.message).toBe('SDP is unavailable. Sorted results require a live connection.');
});

it('keeps filtered and all-notification outage pages separate and forwards the requested filter', async () => {
  const { broker, provider, store, root } = setup();
  const base = {
    id: '123456',
    page: 0,
    description: 'Original',
    conversations: [],
    hasMore: false,
  };
  vi.spyOn(provider, 'detail').mockImplementation(
    async (_token, _signal, _id, _page, includeAutoNotifications) => ({
      ...base,
      includeAutoNotifications,
    }),
  );
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const owner = store.owner('123', store.settings()!.revision);
  const db = new Database(join(root, 'outage-cache.sqlite'));
  db.prepare('INSERT INTO detail_snapshots (owner,detail_key,expires,body) VALUES (?,?,?,?)').run(
    owner,
    '123456:0',
    Date.now() + 60000,
    Buffer.from('legacy unfiltered page'),
  );
  db.close();
  expect(store.getDetail(owner, base.id, 0)).toBeNull();
  await broker.invoke('alice', {
    action: 'readDetail',
    id: base.id,
    page: 0,
    includeAutoNotifications: true,
  });
  expect(provider.detail).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.any(AbortSignal),
    base.id,
    0,
    true,
  );
  expect(store.getDetail(owner, base.id, 0)).toBeNull();
  expect(store.getDetail(owner, base.id, 0, true)?.detail.includeAutoNotifications).toBe(true);
  await broker.invoke('alice', { action: 'readDetail', id: base.id, page: 0 });
  vi.mocked(provider.detail).mockRejectedValue(new SdpProviderError('outage'));
  for (const includeAutoNotifications of [false, true]) {
    const reply = await broker.invoke('alice', {
      action: 'readDetail',
      id: base.id,
      page: 0,
      includeAutoNotifications,
    });
    expect(reply.view.detailSnapshot?.source).toBe('outage-cache');
    expect(reply.view.detail?.includeAutoNotifications).toBe(includeAutoNotifications);
  }
});

it('opens notification tickets outside the visible queue only from a fresh account-bound monitor', async () => {
  vi.useFakeTimers();
  const { broker, provider } = setup();
  vi.mocked(provider.queue).mockImplementation(async (_token, _signal, queue, page) => ({
    queue,
    page,
    hasMore: false,
    tickets:
      queue === 'SOX'
        ? [
            {
              id: '999',
              number: '99',
              subject: 'Monitored SOX ticket',
              status: 'Open',
              priority: 'Low',
              group: 'SOX',
              technician: '',
              createdAt: 1000,
              dueAt: null,
            },
          ]
        : [],
  }));
  const detail = {
    id: '999',
    description: 'Notification detail',
    page: 0,
    hasMore: false,
    conversations: [],
  };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  await signIn(broker);
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  await broker.invoke('alice', { action: 'monitorQueues' });
  expect((await broker.invoke('alice', { action: 'status' })).view.queuePage?.tickets).toEqual([]);
  await signIn(broker, 'peer');
  await expect(broker.invoke('peer', { action: 'readDetail', id: '999', page: 0 })).rejects.toThrow(
    'Load the ticket queue',
  );
  vi.mocked(provider.identity).mockResolvedValue({ id: '456' });
  await signIn(broker, 'other-account');
  await expect(
    broker.invoke('other-account', { action: 'readDetail', id: '999', page: 0 }),
  ).rejects.toThrow('Load the ticket queue');
  vi.setSystemTime(Date.now() + 75_001);
  await expect(
    broker.invoke('alice', { action: 'readDetail', id: '999', page: 0 }),
  ).rejects.toThrow('Load the ticket queue');
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  await broker.invoke('alice', { action: 'monitorQueues' });
  const queueSnapshot = (await broker.invoke('alice', { action: 'status' })).view.snapshot;
  vi.setSystemTime(Date.now() + 1000);
  const opened = (await broker.invoke('alice', { action: 'readDetail', id: '999', page: 0 })).view;
  expect(opened.snapshot?.fetchedAt).toBe(queueSnapshot?.fetchedAt);
  expect(opened.detail).toEqual(detail);
  expect(opened.replyActivity).toMatchObject({ id: '999', subject: 'Monitored SOX ticket' });
  expect(opened.snapshot?.source).toBe('live');
  await expect(
    broker.invoke('alice', { action: 'readDetail', id: '998', page: 0 }),
  ).rejects.toThrow('Load the ticket queue');
  await broker.invoke('alice', { action: 'clearCopies' });
  await expect(
    broker.invoke('alice', { action: 'readDetail', id: '999', page: 0 }),
  ).rejects.toThrow('Load the ticket queue');
});

it('requires every bulk target, history and checklist catalog read to belong to a live account-bound ticket', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  for (const command of [
    {
      action: 'prepareChange' as const,
      mutation: { kind: 'bulk' as const, ids: ['123456', '999'], fields: { priority: 'High' } },
    },
    { action: 'readHistory' as const, id: '999', page: 0 },
    {
      action: 'readResourceChoices' as const,
      id: '999',
      catalog: 'checklist_templates' as const,
      search: '',
      page: 0,
    },
    { action: 'readForwardContext' as const, id: '999' },
  ])
    await expect(broker.invoke('alice', command)).rejects.toThrow(/live|Refresh/);
  expect(vi.mocked(provider.json).mock.calls.some((c) => c[2]?.method)).toBe(false);
});
it('confirms a bulk review once and invalidates the previous queue projection', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const json = vi
    .mocked(provider.json)
    .mockImplementation(async (_url, _signal, init) =>
      init?.method
        ? { response_status: { status_code: 2000 } }
        : { request: { id: '123456', status: { name: 'Open' } } },
    );
  const review = await broker.invoke('alice', {
    action: 'prepareChange',
    mutation: { kind: 'bulk', ids: ['123456'], fields: { priority: 'High' } },
  });
  expect(json.mock.calls.some((c) => c[2]?.method)).toBe(false);
  const command = {
    action: 'confirmChange' as const,
    confirmationId: review.view.review!.confirmationId,
  };
  vi.mocked(provider.queue).mockClear();
  const result = await broker.invoke('alice', command);
  expect(result.view.bulkResult).toEqual([{ id: '123456', status: 'confirmed' }]);
  // The previous projection is replaced by a fresh re-read after the batch.
  expect(provider.queue).toHaveBeenCalledTimes(1);
  expect(result.view.queuePage).toMatchObject({ queue: 'NOC', page: 0 });
  await expect(broker.invoke('alice', command)).rejects.toThrow(/expired|already used/);
  expect(json.mock.calls.filter((c) => c[2]?.method)).toHaveLength(1);
});

it('requires an authenticated account for allowlisted creation and bulk dropdowns', async () => {
  const { broker, provider } = setup();
  await expect(
    broker.invoke('alice', { action: 'readStandardOptions', field: 'group', search: '', page: 0 }),
  ).rejects.toThrow();
  await signIn(broker);
  vi.mocked(provider.json).mockResolvedValue({
    group: [{ id: '1', name: 'NOC' }],
    list_info: { has_more_rows: false },
  });
  const result = await broker.invoke('alice', {
    action: 'readStandardOptions',
    field: 'group',
    search: '',
    page: 0,
  });
  expect(result.view.options?.choices[0]).toEqual({
    label: 'NOC',
    value: { id: '1', name: 'NOC' },
  });
  await expect(
    broker.invoke('alice', {
      action: 'readStandardOptions',
      field: '../../users',
      search: '',
      page: 0,
    } as never),
  ).rejects.toThrow();
  expect((await broker.invoke('alice', { action: 'status' })).view.options).toBeUndefined();
});

it('reads Changes under the signed-in account without saving data or requiring an open ticket', async () => {
  const { broker, provider } = setup();
  await expect(
    broker.invoke('alice', { action: 'readChanges', problemStart: 1000, page: 0 }),
  ).rejects.toThrow('Sign in');
  await signIn(broker);
  vi.mocked(provider.json).mockResolvedValue({ changes: [], list_info: { has_more_rows: false } });
  const result = await broker.invoke('alice', {
    action: 'readChanges',
    problemStart: 1000,
    page: 0,
  });
  expect(result.view.changesPage).toEqual({
    page: 0,
    changes: [],
    hasMore: false,
    detailsComplete: true,
  });
  expect((await broker.invoke('alice', { action: 'status' })).view.changesPage).toBeUndefined();
  vi.mocked(provider.json).mockRejectedValue(new SdpProviderError('denied', 0, 'http', 403));
  const denied = await broker.invoke('alice', {
    action: 'readChanges',
    problemStart: 1000,
    page: 0,
  });
  expect(denied.view.message).toContain('Changes read access');
  expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('connected');
});

it('verifies workflow ticket URLs only in a current account monitor and never saves the description', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  const command = {
    action: 'verifyWorkflowTicket',
    id: '123456',
    problemId: 'canonical',
    environment: 'https://abc.live.dynatrace.com',
  } as const;
  await expect(broker.invoke('alice', command)).rejects.toThrow('current ticket queue scan');
  vi.mocked(provider.queue).mockImplementation(async (_token, _signal, queue, page) => ({
    queue,
    page,
    hasMore: false,
    tickets: [
      {
        id: '123456',
        number: '810129',
        subject: 'NOC',
        status: 'Open',
        priority: 'Low',
        group: queue,
        technician: '',
        createdAt: 1000,
        dueAt: null,
      },
    ],
  }));
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.waitFor(async () => {
    const result = await broker.invoke('alice', { action: 'monitorQueues' });
    expect(result.view.monitor).toBeDefined();
  });
  vi.mocked(provider.json).mockResolvedValue({
    request: {
      id: '123456',
      description:
        '<a href="https://abc.live.dynatrace.com/#problems/problemdetails;pid=canonical">Problem</a>',
    },
  });
  expect((await broker.invoke('alice', command)).view.workflowTicketMatch).toBe(true);
  expect(
    (await broker.invoke('alice', { action: 'status' })).view.workflowTicketMatch,
  ).toBeUndefined();
  expect((await broker.invoke('alice', { action: 'status' })).view.detail).toBeUndefined();
  await expect(broker.invoke('alice', { ...command, id: '999' })).rejects.toThrow(
    'current ticket queue scan',
  );
  vi.mocked(provider.json).mockResolvedValue({ request: { id: '999', description: '' } });
  await expect(broker.invoke('alice', command)).rejects.toThrow();
});

it('refreshes filtered pages and open detail without clearing the view, and throttles repeats', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  const queue = {
    queue: 'NOC' as const,
    page: 1,
    filters: { status: 'Open' },
    hasMore: false,
    tickets: [
      {
        id: '123456',
        number: '810129',
        subject: 'Before',
        status: 'Open',
        priority: 'Low',
        group: 'NOC' as const,
        technician: '',
        createdAt: 1000,
        dueAt: null,
      },
    ],
  };
  vi.mocked(provider.queue).mockResolvedValue(queue);
  const detail = {
    id: '123456',
    page: 1,
    includeAutoNotifications: true,
    description: 'Before',
    conversations: [],
    hasMore: false,
  };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  await broker.invoke('alice', {
    action: 'readQueue',
    queue: 'NOC',
    page: 1,
    filters: queue.filters,
  });
  await broker.invoke('alice', {
    action: 'readDetail',
    id: detail.id,
    page: 1,
    includeAutoNotifications: true,
  });
  vi.mocked(provider.detail).mockResolvedValue({ ...detail, description: 'After' });
  const fresh = await broker.invoke('alice', { action: 'refreshVisible' });
  expect(fresh.view.detail?.description).toBe('After');
  expect(fresh.view.queuePage).toMatchObject({ page: 1, filters: queue.filters });
  expect(provider.queue).toHaveBeenLastCalledWith(
    'access-secret',
    expect.any(AbortSignal),
    'NOC',
    1,
    undefined,
    queue.filters,
    undefined,
    undefined,
  );
  expect(provider.detail).toHaveBeenLastCalledWith(
    'access-secret',
    expect.any(AbortSignal),
    '123456',
    1,
    true,
  );
  await broker.invoke('alice', { action: 'refreshVisible' });
  expect(provider.detail).toHaveBeenCalledTimes(2);
});

it('refreshes on every 30-second client tick even when a tick arrives a little early', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  vi.useFakeTimers({ toFake: ['Date'] });
  const reads = () => vi.mocked(provider.queue).mock.calls.length;
  const before = reads();
  await broker.invoke('alice', { action: 'refreshVisible' });
  expect(reads()).toBe(before + 1);
  // IPC or gateway latency can shift a 30-second timer by a few milliseconds.
  vi.setSystemTime(Date.now() + 29_990);
  await broker.invoke('alice', { action: 'refreshVisible' });
  expect(reads()).toBe(before + 2);
  vi.setSystemTime(Date.now() + 10_000);
  await broker.invoke('alice', { action: 'refreshVisible' });
  expect(reads()).toBe(before + 2);
});

it('discards a late automatic refresh when the analyst changes queues', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const old = (await broker.invoke('alice', { action: 'status' })).view.queuePage!;
  let resolve!: (page: typeof old) => void;
  vi.mocked(provider.queue).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const refreshing = broker.invoke('alice', { action: 'refreshVisible' });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  expect((await broker.invoke('alice', { action: 'status' })).view.queuePage?.queue).toBe('NOC');
  await broker.invoke('alice', { action: 'readQueue', queue: 'SOX', page: 0 });
  resolve(old);
  expect((await refreshing).view.queuePage?.queue).toBe('SOX');
});

it('keeps the original expiry during automatic-refresh outages and clears denied data', async () => {
  const { broker, provider } = setup();
  await signIn(broker);
  const initial = await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  vi.mocked(provider.queue).mockRejectedValue(new SdpProviderError('outage'));
  const failed = await broker.invoke('alice', { action: 'refreshVisible' });
  expect(failed.view.snapshot).toEqual(initial.view.snapshot);
  expect(failed.view.message).toContain('refresh is delayed');
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 60_001);
  vi.mocked(provider.queue).mockRejectedValue(new SdpProviderError('denied'));
  const denied = await broker.invoke('alice', { action: 'refreshVisible' });
  expect(denied.view.status).toBe('expired');
  expect(denied.view.queuePage).toBeUndefined();
  expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('disconnected');
});
it('reads only the open live ticket’s inline images, beside other work and without signing out', async () => {
  const { broker, provider } = setup();
  const image = (path: string) =>
    `<img src="/app/itdesk/servlet/SDODAuthServlet?path=${path}&amp;ACTION=FILE">`;
  const detail = {
    id: '123456',
    page: 0,
    hasMore: false,
    description: image('41') + image('42') + image('44') + image('45'),
    conversations: [
      { id: '7', subject: 'Re', body: image('43'), author: 'Requester', createdAt: 1000 },
    ],
  };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  const png = (size: number) =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(size),
    ]);
  const binary = vi.spyOn(provider, 'binary').mockImplementation(async (url) => {
    const path = url.split('/').pop();
    if (path === '42') return Buffer.from('<html>login</html>');
    if (path === '43') throw new SdpProviderError('denied', 0, 'http', 404);
    return path === '41' ? png(16) : png(3 * 1024 * 1024 - 8);
  });
  await signIn(broker);
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  await expect(
    broker.invoke('alice', { action: 'readInlineImages', id: '123456', paths: ['41'] }),
  ).rejects.toThrow('Open this ticket');
  await broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
  let finish!: () => void;
  vi.mocked(provider.detail).mockImplementation(
    () => new Promise((resolve) => (finish = () => resolve(detail))),
  );
  const detailRead = broker.invoke('alice', { action: 'readDetail', id: '123456', page: 0 });
  const reply = await broker.invoke('alice', {
    action: 'readInlineImages',
    id: '123456',
    paths: ['41', '42', '43', '99', '44', '45'],
  });
  expect(reply.view.inlineImages?.images.map((item) => [item.path, item.contentType])).toEqual([
    ['41', 'image/png'],
    ['44', 'image/png'],
  ]);
  expect(reply.view.inlineImages?.deferred).toEqual(['45']);
  expect(binary.mock.calls.map(([url]) => url)).toEqual(
    ['_uploads/41', '_uploads/42', 'notifications/7/_uploads/43', '_uploads/44'].map(
      (path) => `https://support.campingworld.com/app/itdesk/api/v3/requests/123456/${path}`,
    ),
  );
  expect(binary.mock.calls[0]?.[2]).toEqual({
    headers: {
      Authorization: 'Zoho-oauthtoken access-secret',
      Accept: 'application/vnd.manageengine.sdp.v3+json',
    },
  });
  finish();
  await detailRead;
  expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('connected');
});
it('reads note flags for the visible live queue page beside other work and reuses fresh flags', async () => {
  const { broker, provider } = setup();
  const queueNotes = vi.spyOn(provider, 'queueNotes').mockResolvedValue(new Set(['123456']));
  await signIn(broker);
  await expect(
    broker.invoke('alice', { action: 'readQueueNotes', queue: 'NOC', page: 0 }),
  ).rejects.toThrow('Load a live queue');
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  await expect(
    broker.invoke('alice', { action: 'readQueueNotes', queue: 'SOX', page: 0 }),
  ).rejects.toThrow('Load a live queue');
  const reply = await broker.invoke('alice', { action: 'readQueueNotes', queue: 'NOC', page: 0 });
  expect(reply.view.queueNotes).toEqual({ queue: 'NOC', page: 0, ids: ['123456'] });
  expect(queueNotes).toHaveBeenCalledWith('access-secret', expect.any(AbortSignal), ['123456']);
  await broker.invoke('alice', { action: 'readQueueNotes', queue: 'NOC', page: 0 });
  expect(queueNotes).toHaveBeenCalledTimes(1);
  queueNotes.mockRejectedValueOnce(new SdpProviderError('denied', 0, 'http', 403));
  await broker.invoke('alice', { action: 'clearCopies' });
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  await expect(
    broker.invoke('alice', { action: 'readQueueNotes', queue: 'NOC', page: 0 }),
  ).rejects.toThrow();
  expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('connected');
});
it('reads a chosen page size and added queue, refreshes with them and saves them under their own key', async () => {
  const { broker, provider, store } = setup();
  const base = vi.mocked(provider.queue).getMockImplementation()!;
  vi.mocked(provider.queue).mockImplementation(async (...args) => ({
    ...(await base(...args)),
    ...(args[6] && args[6] !== 50 ? { pageSize: args[6] as 100 } : {}),
  }));
  await signIn(broker);
  const reply = await broker.invoke('alice', {
    action: 'readQueue',
    queue: 'Network Ops',
    page: 1,
    pageSize: 100,
  });
  expect(reply.view.queuePage).toMatchObject({ queue: 'Network Ops', page: 1, pageSize: 100 });
  expect(provider.queue).toHaveBeenLastCalledWith(
    'access-secret',
    expect.any(AbortSignal),
    'Network Ops',
    1,
    undefined,
    undefined,
    100,
    undefined,
  );
  const owner = store.owner('123', store.settings()!.revision);
  expect(store.getQueue(owner, 'Network Ops', 1, 100)?.queuePage.pageSize).toBe(100);
  expect(store.getQueue(owner, 'Network Ops', 1)).toBeNull();
  await broker.invoke('alice', { action: 'refreshVisible' });
  expect(provider.queue).toHaveBeenLastCalledWith(
    'access-secret',
    expect.any(AbortSignal),
    'Network Ops',
    1,
    undefined,
    undefined,
    100,
    undefined,
  );
  // A default-size read is unchanged for older clients: no size is sent back.
  const plain = await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  expect(plain.view.queuePage).not.toHaveProperty('pageSize');
});
it('searches all of SDP beside other work and lets this session open only its latest results', async () => {
  const { broker, provider } = setup();
  const found = {
    id: '777',
    number: '820001',
    subject: 'Found elsewhere',
    status: 'Open',
    priority: 'Low',
    group: 'Field Services',
    technician: 'Example technician',
    createdAt: 1000,
    dueAt: null,
  };
  const search = vi
    .spyOn(provider, 'searchTickets')
    .mockResolvedValue({ query: 'printer', page: 0, hasMore: false, tickets: [found] });
  const detail = { id: '777', page: 0, description: '', conversations: [], hasMore: false };
  vi.spyOn(provider, 'detail').mockResolvedValue(detail);
  await signIn(broker);
  await expect(
    broker.invoke('alice', { action: 'readDetail', id: '777', page: 0 }),
  ).rejects.toThrow('Load the ticket queue');
  await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
  const reply = await broker.invoke('alice', {
    action: 'searchTickets',
    query: 'printer',
    page: 0,
  });
  expect(reply.view.ticketSearch?.tickets).toEqual([found]);
  expect(search).toHaveBeenCalledWith('access-secret', expect.any(AbortSignal), 'printer', 0);
  // The search does not replace the visible queue.
  expect(reply.view.queuePage?.queue).toBe('NOC');
  expect((await broker.invoke('alice', { action: 'status' })).view.ticketSearch).toBeUndefined();
  // Another session cannot open what this one found.
  await signIn(broker, 'bob');
  await broker.invoke('bob', { action: 'readQueue', queue: 'NOC', page: 0 });
  await expect(broker.invoke('bob', { action: 'readDetail', id: '777', page: 0 })).rejects.toThrow(
    'Load the ticket queue',
  );
  expect(
    (await broker.invoke('alice', { action: 'readDetail', id: '777', page: 0 })).view.detail,
  ).toEqual(detail);
  // A provider failure does not sign the person out.
  search.mockRejectedValueOnce(new SdpProviderError('invalid'));
  await expect(
    broker.invoke('alice', { action: 'searchTickets', query: 'printer', page: 1 }),
  ).rejects.toThrow();
  expect((await broker.invoke('alice', { action: 'status' })).view.status).toBe('connected');
});
