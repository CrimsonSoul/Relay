import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdpBroker } from './SdpBroker';
import { SdpServerStore } from './SdpServerStore';
import { SdpProvider, SdpProviderError } from './SdpProvider';
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
  vi.spyOn(provider, 'identity').mockResolvedValue('123');
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
    expect(scopes.filter((s) => s.startsWith('SDPOnDemand.setup.'))).toEqual([
      'SDPOnDemand.setup.READ',
    ]);
    expect(authorization.searchParams.get('prompt')).toBe('consent');
    expect(authorization.searchParams.get('code_challenge')).toBe(challenge);
    expect(provider.token).not.toHaveBeenCalled();
  });
  it('binds identity to Zoho and keeps credentials out of public replies and stored plaintext', async () => {
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
    vi.mocked(provider.identity).mockResolvedValue('456');
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
    vi.advanceTimersByTime(3580_000);
    vi.mocked(provider.token).mockRejectedValue(new SdpProviderError('outage'));
    expect((await broker.invoke('alice', { action: 'readTestTicket' })).view.status).toBe(
      'expired',
    );
    expect(store.get(store.owner('123', store.settings()!.revision))).toBeNull();
  });
  it('isolates cached queue pages by queue, page, and verified identity', async () => {
    const { broker, provider, store } = setup();
    await signIn(broker);
    await broker.invoke('alice', { action: 'readQueue', queue: 'NOC', page: 0 });
    vi.mocked(provider.identity).mockResolvedValue('456');
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
    vi.mocked(provider.identity).mockResolvedValue('456');
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
    json
      .mockResolvedValueOnce({ request: { id: '123456', subject: 'Original' } })
      .mockResolvedValueOnce({
        response_status: { status_code: 2000 },
        request: { id: '123456', display_id: '810129' },
      });
    const result = await broker.invoke('alice', { action: 'confirmChange', confirmationId });
    expect(result.view.changeResult?.id).toBe('123456');
    expect(json.mock.calls.at(-1)?.[2]?.method).toBe('PUT');
    expect(store.getQueue(store.owner('123', store.settings()!.revision), 'NOC', 0)).toBeNull();
    await expect(
      broker.invoke('alice', { action: 'confirmChange', confirmationId }),
    ).rejects.toThrow();
    expect(json).toHaveBeenCalledTimes(3);
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
  expect(provider.queue).toHaveBeenCalledTimes(3);
  finish({ request: { id: '999', display_id: '810130' } });
  await saving;
  await broker.invoke('alice', { action: 'monitorQueues' });
  await vi.advanceTimersByTimeAsync(0);
  expect(
    (await broker.invoke('alice', { action: 'monitorQueues' })).view.monitor?.generation,
  ).not.toBe(before.view.monitor?.generation);
  expect(provider.queue).toHaveBeenCalledTimes(6);
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
  vi.mocked(provider.identity).mockResolvedValue('456');
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
