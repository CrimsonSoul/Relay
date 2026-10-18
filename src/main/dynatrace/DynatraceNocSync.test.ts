import type PocketBase from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_NOC_OAUTH_SCOPES,
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
} from '@shared/dynatraceProblems';
import {
  buildNocPullQuery,
  DynatraceNocSync,
  parseNocStrings,
  parseNocTimestamp,
} from './DynatraceNocSync';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';

vi.mock('../logger', () => ({
  loggers: { main: { info: vi.fn(), warn: vi.fn() } },
}));

type Row = Record<string, unknown> & { id: string };

const CONFIG: DynatraceProblemsConfig = {
  environmentUrl: 'https://abc12345.apps.dynatrace.com',
  apiToken: '',
  oauth: {
    clientId: 'dt0s02.TESTCLIENT',
    clientSecret: 'dt0s02.TESTCLIENT.TESTSECRET',
    accountUuid: '00000000-0000-4000-8000-000000000000',
  },
  alertingProfiles: null,
  customDqlMatcher: null,
};

function matches(row: Row, filter: string): boolean {
  if (!filter) return true;
  return filter.split(' || ').some((group) =>
    group.split(' && ').every((clause) => {
      const match = /^(\w+) (!?=) (".*")$/.exec(clause.trim());
      if (!match) throw new Error(`Unsupported filter clause: ${clause}`);
      const [, field, operator, literal] = match;
      const value = String(row[field!] ?? '');
      const expected = JSON.parse(literal!) as string;
      return operator === '=' ? value === expected : value !== expected;
    }),
  );
}

function fakePocketBase(seed: Record<string, Row[]>) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, [...rows]]));
  let sequence = 0;
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const pb = {
    filter: (expression: string, params: Record<string, unknown>) =>
      expression.replace(/\{:(\w+)\}/g, (_, key: string) => JSON.stringify(params[key])),
    collection: (name: string) => ({
      getList: async (
        _page: number,
        perPage: number,
        options: { filter?: string; sort?: string },
      ) => {
        const items = table(name).filter((row) => matches(row, options.filter ?? ''));
        if (options.sort === '-created') {
          items.sort((a, b) => String(b.created).localeCompare(String(a.created)));
        }
        return { items: items.slice(0, perPage), totalItems: items.length };
      },
      getFullList: async (options: { filter?: string }) =>
        table(name).filter((row) => matches(row, options.filter ?? '')),
      getOne: async (id: string) => ({ ...table(name).find((row) => row.id === id)! }),
      create: async (data: Record<string, unknown>) => {
        const row = { id: `${name}-${++sequence}`, created: '2026-10-16 12:00:00.000Z', ...data };
        table(name).push(row);
        return row;
      },
      update: async (id: string, data: Record<string, unknown>) => {
        const row = table(name).find((candidate) => candidate.id === id)!;
        const second = String(++sequence % 60).padStart(2, '0');
        Object.assign(row, data, { updated: `2026-10-16 13:30:${second}.000Z` });
        return row;
      },
    }),
  };
  return { pb: pb as unknown as PocketBase, table };
}

function fakeFetch(ingestStatus = 202) {
  const ingested: Record<string, unknown>[][] = [];
  const tokenScopes: string[] = [];
  const fetchImpl = vi.fn(async (input: URL | string, init?: Parameters<typeof fetch>[1]) => {
    if (String(input).startsWith('https://sso.dynatrace.com/')) {
      tokenScopes.push(new URLSearchParams(String(init?.body)).get('scope') ?? '');
      return new Response(
        JSON.stringify({ access_token: 'test-token', token_type: 'Bearer', expires_in: 300 }),
      );
    }
    ingested.push(JSON.parse(String(init?.body)) as Record<string, unknown>[]);
    return new Response(null, { status: ingestStatus });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, ingested, tokenScopes };
}

const PROBLEMS: Row[] = [
  { id: 'p1', problemId: '-111_1V2', displayId: 'P-26108641' },
  { id: 'p2', problemId: '-222_2V2', displayId: 'P-26108645' },
];
const START = Date.parse('2026-10-16T13:00:00Z');

function seeded(extra: Record<string, Row[]> = {}) {
  return fakePocketBase({
    [DYNATRACE_PROBLEMS_COLLECTION]: PROBLEMS,
    [DYNATRACE_PROBLEM_SYNC_COLLECTION]: [{ id: 'sync-1', key: 'primary' }],
    ...extra,
  });
}

const fetchOnly =
  (records: Record<string, unknown>[]) =>
  async (_config: unknown, text: string): Promise<Record<string, unknown>[]> =>
    text.startsWith('fetch') ? records : [];

const PENDING_NOTE: Row = {
  id: 'note1',
  problemId: '-111_1V2',
  noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  note: 'UPS vendor dispatched',
  author: 'Kelcee Gabbard',
  analyst: 'Kelcee.Gabbard@example.com',
  enteredBy: 'relay:kgabbard@NOC-WS01',
  source: 'relay',
  state: 'active',
  sync: 'pending',
};
const PENDING_ACK: Row = {
  id: 'state1',
  problemId: '-111_1V2',
  addressed: true,
  addressedAt: '2026-10-16 12:01:00.000Z',
  addressedBy: 'Kelcee Gabbard',
  analyst: 'kelcee.gabbard@example.com',
  ackId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ackState: 'addressed',
  noteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scopeEntities: ['HOST-1', 'CUSTOM_DEVICE-2'],
  enteredBy: 'relay:kgabbard@NOC-WS01',
  source: 'relay',
  sync: 'pending',
  updated: '2026-10-16 12:01:00.000Z',
};

describe('DynatraceNocSync outbox', () => {
  it('sends pending notes and acks in one batch in the shared shapes', async () => {
    const { pb, table } = seeded({
      [DYNATRACE_PROBLEM_NOTES_COLLECTION]: [
        { ...PENDING_NOTE },
        { id: 'legacy', problemId: '-111_1V2', note: 'Before the shared sync', sync: '' },
      ],
      [DYNATRACE_PROBLEM_STATES_COLLECTION]: [{ ...PENDING_ACK }],
    });
    const { fetchImpl, ingested, tokenScopes } = fakeFetch();

    await new DynatraceNocSync(
      async () => [],
      fetchImpl,
      () => START,
    ).run(pb, CONFIG);

    expect(tokenScopes).toEqual([DYNATRACE_NOC_OAUTH_SCOPES.join(' ')]);
    expect(ingested).toEqual([
      [
        {
          'event.type': 'noc.note',
          'event.provider': 'cwgs.relay',
          note_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          display_id: 'P-26108641',
          display_ids: ['P-26108641'],
          analyst: 'kelcee.gabbard@example.com',
          analyst_name: 'Kelcee Gabbard',
          entered_by: 'relay:kgabbard@NOC-WS01',
          source: 'relay',
          text: 'UPS vendor dispatched',
          state: 'active',
        },
        {
          'event.type': 'noc.ack',
          'event.provider': 'cwgs.relay',
          ack_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          display_id: 'P-26108641',
          analyst: 'kelcee.gabbard@example.com',
          analyst_name: 'Kelcee Gabbard',
          entered_by: 'relay:kgabbard@NOC-WS01',
          source: 'relay',
          state: 'addressed',
          note_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          scope_entities: ['HOST-1', 'CUSTOM_DEVICE-2'],
        },
      ],
    ]);
    const notes = table(DYNATRACE_PROBLEM_NOTES_COLLECTION);
    expect(notes.find((note) => note.id === 'note1')?.sync).toBe('synced');
    expect(notes.find((note) => note.id === 'legacy')?.sync).toBe('');
    expect(table(DYNATRACE_PROBLEM_STATES_COLLECTION)[0]?.sync).toBe('synced');
    expect(table(DYNATRACE_PROBLEM_SYNC_COLLECTION)[0]).toMatchObject({ nocPendingCount: 0 });
  });

  it('sends a cleared ack without scope or note', async () => {
    const { pb } = seeded({
      [DYNATRACE_PROBLEM_STATES_COLLECTION]: [
        { ...PENDING_ACK, addressed: false, addressedBy: '', analyst: '', ackState: 'cleared' },
      ],
    });
    const { fetchImpl, ingested } = fakeFetch();
    await new DynatraceNocSync(
      async () => [],
      fetchImpl,
      () => START,
    ).run(pb, CONFIG);

    expect(ingested[0]?.[0]).toMatchObject({ 'event.type': 'noc.ack', state: 'cleared' });
    expect(ingested[0]?.[0]).not.toHaveProperty('scope_entities');
    expect(ingested[0]?.[0]).not.toHaveProperty('note_id');
  });

  it('keeps records pending and backs off 30s then 1m when Dynatrace is unavailable', async () => {
    let now = START;
    const { pb, table } = seeded({ [DYNATRACE_PROBLEM_NOTES_COLLECTION]: [{ ...PENDING_NOTE }] });
    const { fetchImpl, ingested } = fakeFetch(503);
    const sync = new DynatraceNocSync(
      async () => [],
      fetchImpl,
      () => now,
    );

    await sync.run(pb, CONFIG);
    expect(ingested).toHaveLength(1);
    expect(table(DYNATRACE_PROBLEM_NOTES_COLLECTION)[0]?.sync).toBe('pending');
    expect(table(DYNATRACE_PROBLEM_SYNC_COLLECTION)[0]).toMatchObject({ nocPendingCount: 1 });
    expect(String(table(DYNATRACE_PROBLEM_SYNC_COLLECTION)[0]?.nocSyncError)).toContain('HTTP 503');

    for (const [advance, expected] of [
      [29_000, 1],
      [1_000, 2],
      [59_000, 2],
      [1_000, 3],
    ] as const) {
      now += advance;
      await sync.run(pb, CONFIG);
      expect(ingested).toHaveLength(expected);
    }
  });

  it('marks a rejected batch as an error, keeps it locally, and stops resending it', async () => {
    let now = START;
    const { pb, table } = seeded({ [DYNATRACE_PROBLEM_NOTES_COLLECTION]: [{ ...PENDING_NOTE }] });
    const { fetchImpl, ingested } = fakeFetch(400);
    const sync = new DynatraceNocSync(
      async () => [],
      fetchImpl,
      () => now,
    );

    await sync.run(pb, CONFIG);
    now += 60_000;
    await sync.run(pb, CONFIG);

    expect(ingested).toHaveLength(1);
    expect(table(DYNATRACE_PROBLEM_NOTES_COLLECTION)[0]).toMatchObject({
      sync: 'error',
      syncError: expect.stringContaining('kept in Relay'),
    });
  });
});

describe('DynatraceNocSync reads', () => {
  const noteRecord = (overrides: Record<string, unknown> = {}) => ({
    timestamp: '2026-10-16T12:30:00.123456789Z',
    'event.type': 'noc.note',
    record_id: 'ih-note-1',
    display_id: 'P-26108641',
    display_ids: '["P-26108641","P-26108645"]',
    analyst: 'Paris@Example.com',
    analyst_name: 'Paris',
    entered_by: 'infra-health',
    source: 'infra',
    text: 'Vendor says fiber cut',
    state: 'active',
    ...overrides,
  });

  it('upserts notes per problem, keeps the newest, and advances the cursor', async () => {
    let now = START;
    const { pb, table } = seeded();
    const query = vi.fn(fetchOnly([noteRecord(), { 'event.type': 'noc.note' }]));
    const sync = new DynatraceNocSync(query, fakeFetch().fetchImpl, () => now);

    await sync.run(pb, CONFIG);
    await sync.run(pb, CONFIG);
    expect(table(DYNATRACE_PROBLEM_NOTES_COLLECTION)).toEqual([
      expect.objectContaining({
        problemId: '-111_1V2',
        noteId: 'ih-note-1',
        note: 'Vendor says fiber cut',
        author: 'Paris',
        analyst: 'paris@example.com',
        source: 'infra',
        state: 'active',
        sync: 'synced',
        grailTs: '2026-10-16T12:30:00.123Z',
      }),
      expect.objectContaining({ problemId: '-222_2V2', noteId: 'ih-note-1' }),
    ]);
    expect(table(DYNATRACE_PROBLEM_SYNC_COLLECTION)[0]?.nocCursor).toBe('2026-10-16T12:30:00.123Z');

    query.mockImplementation(
      fetchOnly([noteRecord({ timestamp: '2026-10-16T12:40:00Z', state: 'deleted' })]),
    );
    now += 20_000;
    await sync.run(pb, CONFIG);
    expect(table(DYNATRACE_PROBLEM_NOTES_COLLECTION).map((note) => note.state)).toEqual([
      'deleted',
      'deleted',
    ]);

    const pulls = query.mock.calls
      .map((call) => String((call as unknown[])[1]))
      .filter((text) => text.startsWith('fetch'));
    expect(pulls[0]).toContain('from: -35d');
    expect(pulls[1]).toContain('from: toTimestamp("2026-10-16T12:25:00.123Z")');
  });

  it('continues a full read from its newest record instead of skipping the older ones', async () => {
    const { pb, table } = seeded();
    const page = (at: (index: number) => string) =>
      Array.from({ length: 10_000 }, (_, index) =>
        noteRecord({
          record_id: `bulk-${index}`,
          display_id: 'P-UNKNOWN',
          display_ids: null,
          timestamp: at(index),
        }),
      );
    // Oldest first: the page ends at the newest record it holds, so nothing older is skipped.
    const query = vi.fn(
      fetchOnly(page((index) => new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString())),
    );
    const sync = new DynatraceNocSync(query, fakeFetch().fetchImpl, () => START);

    await sync.run(pb, CONFIG);
    const status = () => table(DYNATRACE_PROBLEM_SYNC_COLLECTION)[0];
    expect(status()?.nocCursor).toBe('2026-10-01T02:46:39.000Z');
    expect(status()?.nocSyncError).toBe('');

    // A full page that cannot move the cursor reports it and keeps the cursor where it was.
    query.mockImplementation(fetchOnly(page(() => '2026-10-01T02:46:39Z')));
    await sync.run(pb, CONFIG);
    expect(status()?.nocCursor).toBe('2026-10-01T02:46:39.000Z');
    expect(status()?.nocSyncError).toContain('Reading NOC notes from Dynatrace failed');

    const pulls = query.mock.calls
      .map((call) => String((call as unknown[])[1]))
      .filter((text) => text.startsWith('fetch'));
    expect(pulls[1]).toContain('from: toTimestamp("2026-10-01T02:41:39.000Z")');
  });

  it('sends a Relay edit as the newest row and never lets the older Grail copy undo it', async () => {
    const original = {
      ...PENDING_NOTE,
      noteId: 'ih-note-1',
      note: 'Vendor says fiber cut',
      sync: 'synced',
      grailTs: '2026-10-16T12:30:00.123Z',
      created: '2026-10-16 12:30:05.000Z',
    };
    const edit = {
      ...original,
      id: 'note-edit',
      note: 'Fiber repaired',
      sync: 'pending',
      created: '2026-10-16 12:35:00.000Z',
    };
    const { pb, table } = seeded({ [DYNATRACE_PROBLEM_NOTES_COLLECTION]: [original, edit] });
    const fetch = fakeFetch();
    // Grail still returns the earlier version when the edit is sent.
    const query = vi.fn(fetchOnly([noteRecord({ display_ids: '["P-26108641"]' })]));
    await new DynatraceNocSync(query, fetch.fetchImpl, () => START).run(pb, CONFIG);

    expect(fetch.ingested[0]).toEqual([
      expect.objectContaining({ note_id: 'ih-note-1', text: 'Fiber repaired', state: 'active' }),
    ]);
    const rows = table(DYNATRACE_PROBLEM_NOTES_COLLECTION);
    expect(rows.find((row) => row.id === 'note-edit')).toMatchObject({
      note: 'Fiber repaired',
      sync: 'synced',
    });

    query.mockImplementation(
      fetchOnly([
        noteRecord({
          display_ids: '["P-26108641"]',
          timestamp: '2026-10-16T12:36:00Z',
          text: 'Fiber repaired',
          source: 'relay',
        }),
      ]),
    );
    await new DynatraceNocSync(query, fetch.fetchImpl, () => START + 20_000).run(pb, CONFIG);
    expect(rows.find((row) => row.id === 'note-edit')).toMatchObject({
      grailTs: '2026-10-16T12:36:00.000Z',
    });
    expect(rows.find((row) => row.id === original.id)?.grailTs).toBe('2026-10-16T12:30:00.123Z');
  });

  it('confirms Relay’s own records when they come back from Grail', async () => {
    const { pb, table } = seeded({
      [DYNATRACE_PROBLEM_NOTES_COLLECTION]: [{ ...PENDING_NOTE, sync: 'synced' }],
      [DYNATRACE_PROBLEM_STATES_COLLECTION]: [{ ...PENDING_ACK, sync: 'synced' }],
    });
    const query = fetchOnly([
      noteRecord({
        record_id: PENDING_NOTE.noteId,
        display_ids: '["P-26108641"]',
        text: 'UPS vendor dispatched',
        source: 'relay',
      }),
      {
        timestamp: '2026-10-16T12:30:01Z',
        'event.type': 'noc.ack',
        record_id: PENDING_ACK.ackId,
        display_id: 'P-26108641',
        analyst_name: 'Kelcee Gabbard',
        state: 'addressed',
        note_id: PENDING_ACK.noteId,
        scope_entities: '["HOST-1","CUSTOM_DEVICE-2"]',
        source: 'relay',
      },
    ]);
    await new DynatraceNocSync(query, fakeFetch().fetchImpl, () => START).run(pb, CONFIG);

    expect(table(DYNATRACE_PROBLEM_NOTES_COLLECTION)).toHaveLength(1);
    expect(table(DYNATRACE_PROBLEM_NOTES_COLLECTION)[0]?.grailTs).toBe('2026-10-16T12:30:00.123Z');
    expect(table(DYNATRACE_PROBLEM_STATES_COLLECTION)[0]).toMatchObject({
      addressed: true,
      grailTs: '2026-10-16T12:30:01.000Z',
      scopeEntities: ['HOST-1', 'CUSTOM_DEVICE-2'],
    });
  });

  it('applies a newer remote clear but never overwrites a pending local ack', async () => {
    const query = fetchOnly([
      {
        timestamp: '2026-10-16T12:50:00Z',
        'event.type': 'noc.ack',
        record_id: 'ih-ack-9',
        display_id: 'P-26108641',
        state: 'cleared',
        source: 'infra',
      },
    ]);

    const pending = seeded({ [DYNATRACE_PROBLEM_STATES_COLLECTION]: [{ ...PENDING_ACK }] });
    await new DynatraceNocSync(query, fakeFetch(503).fetchImpl, () => START).run(
      pending.pb,
      CONFIG,
    );
    expect(pending.table(DYNATRACE_PROBLEM_STATES_COLLECTION)[0]).toMatchObject({
      addressed: true,
      ackId: PENDING_ACK.ackId,
    });

    const synced = seeded({
      [DYNATRACE_PROBLEM_STATES_COLLECTION]: [
        { ...PENDING_ACK, sync: 'synced', grailTs: '2026-10-16 12:01:00.000Z' },
      ],
    });
    await new DynatraceNocSync(query, fakeFetch().fetchImpl, () => START).run(synced.pb, CONFIG);
    expect(synced.table(DYNATRACE_PROBLEM_STATES_COLLECTION)[0]).toMatchObject({
      addressed: false,
      ackState: 'cleared',
      ackId: 'ih-ack-9',
      addressedBy: '',
      source: 'infra',
    });
  });

  it('publishes the active roster with the NOC scopes', async () => {
    const { pb, table } = seeded();
    const query = vi.fn(async (_config: unknown, text: string) =>
      text.startsWith('load')
        ? [
            { email: 'Weston@Example.com', name: 'Weston' },
            { email: 'connor@example.com', name: 'Connor' },
          ]
        : [],
    );
    await new DynatraceNocSync(query, fakeFetch().fetchImpl).run(pb, CONFIG);

    expect(query).toHaveBeenCalledWith(
      CONFIG,
      expect.stringContaining('load "/lookups/noc_analysts"\n| filter active == "true"'),
      undefined,
      DYNATRACE_NOC_OAUTH_SCOPES,
    );
    expect(table(DYNATRACE_PROBLEM_SYNC_COLLECTION)[0]).toMatchObject({
      nocAnalysts: [
        { email: 'connor@example.com', name: 'Connor' },
        { email: 'weston@example.com', name: 'Weston' },
      ],
      nocSyncError: '',
    });
  });

  it('does nothing without an OAuth client', async () => {
    const query = vi.fn();
    await new DynatraceNocSync(query, fakeFetch().fetchImpl).run(seeded().pb, {
      ...CONFIG,
      oauth: undefined,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('NOC sync helpers', () => {
  it('parses Grail nanosecond and PocketBase timestamps', () => {
    expect(parseNocTimestamp('2026-10-16T12:30:00.123456789Z')).toBe(
      Date.parse('2026-10-16T12:30:00.123Z'),
    );
    expect(parseNocTimestamp('2026-10-16 12:30:00.000Z')).toBe(
      Date.parse('2026-10-16T12:30:00.000Z'),
    );
    expect(parseNocTimestamp('not a date')).toBeNull();
  });

  it('parses list fields from JSON text or commas', () => {
    expect(parseNocStrings('["P-1","P-2"]')).toEqual(['P-1', 'P-2']);
    expect(parseNocStrings('P-1, P-2')).toEqual(['P-1', 'P-2']);
    expect(parseNocStrings(['HOST-1'])).toEqual(['HOST-1']);
    expect(parseNocStrings(null)).toEqual([]);
  });

  it('reads the newest record per id, oldest first and one page at a time', () => {
    expect(buildNocPullQuery(null)).toContain(
      '| dedup { event.type, record_id }\n| sort timestamp asc\n| limit 10000',
    );
  });
});
