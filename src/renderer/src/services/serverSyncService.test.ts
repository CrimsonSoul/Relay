import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareServerSync } from './serverSyncService';

const fixture = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  failSave: false,
  failDelete: false,
  calls: [] as string[],
  client: {} as object,
  online: true,
  mutateAfterSave: false,
  onRead: null as (() => void) | null,
}));

vi.mock('./pocketbase', () => ({
  requireOnline: () => {
    if (!fixture.online) throw new Error('Offline');
  },
  getPb: () => fixture.client,
}));

function makeClient() {
  let revision = 0;
  const applyOperation = (op: { kind: string; id?: string; data?: Record<string, unknown> }) => {
    if (op.kind === 'delete') {
      fixture.rows = fixture.rows.filter((row) => row.id !== op.id);
      return { status: 204, body: null };
    }
    let row = fixture.rows.find((row) => row.id === op.id);
    if (op.kind === 'create') {
      row = { id: `created-${++revision}`, ...op.data };
      fixture.rows.push(row);
    } else Object.assign(row!, op.data);
    row!.updated = `revision-${++revision}`;
    return { status: 200, body: structuredClone(row) };
  };
  return {
    authStore: { token: 'same-account' },
    collection: (name: string) => {
      expect(name).toBe('servers');
      return {
        getFullList: async () => {
          fixture.onRead?.();
          return structuredClone(fixture.rows);
        },
      };
    },
    createBatch: () => {
      const operations: { kind: string; id?: string; data?: Record<string, unknown> }[] = [];
      return {
        collection: (name: string) => {
          expect(name).toBe('servers');
          return {
            create: (data: Record<string, unknown>) => operations.push({ kind: 'create', data }),
            update: (id: string, data: Record<string, unknown>) =>
              operations.push({ kind: 'update', id, data }),
            delete: (id: string) => operations.push({ kind: 'delete', id }),
          };
        },
        send: async () => {
          const deleting = operations.some((op) => op.kind === 'delete');
          fixture.calls.push(deleting ? 'delete' : 'save');
          if ((deleting && fixture.failDelete) || (!deleting && fixture.failSave)) {
            throw Object.assign(new Error('Batch rejected'), { status: 400 });
          }
          const results = operations.map(applyOperation);
          if (!deleting && fixture.mutateAfterSave)
            fixture.rows.push(server('concurrent', 'NEW-SHARED'));
          return results;
        },
      };
    },
  };
}

function server(id: string, name: string, fields: Record<string, unknown> = {}) {
  return { id, name, owner: 'Ops', comment: 'Keep', updated: 'before', ...fields };
}
function file(rows: unknown) {
  return { name: 'relay-servers.json', text: JSON.stringify(rows), buffer: new ArrayBuffer(0) };
}

beforeEach(() => {
  fixture.rows = [
    server('shared', 'SHARED-VDI', { custom: 'preserved' }),
    server('user', 'USER-VDI'),
  ];
  fixture.calls = [];
  fixture.onRead = null;
  fixture.failSave = false;
  fixture.failDelete = false;
  fixture.online = true;
  fixture.mutateAfterSave = false;
  fixture.client = makeClient();
});

describe('Servers list synchronization', () => {
  it('previews adds, changes and removals without writing, then keeps matching IDs and unknown fields', async () => {
    const plan = await prepareServerSync(
      file([{ name: 'shared-vdi', owner: 'Platform' }, { name: 'NEW-SHARED' }]),
    );
    expect(plan.added).toEqual(['NEW-SHARED']);
    expect(plan.updated).toEqual(['SHARED-VDI']);
    expect(plan.removed).toEqual(['USER-VDI']);
    expect(fixture.calls).toEqual([]);
    expect(JSON.parse(plan.backupJson)).toEqual(fixture.rows);
    const result = await plan.apply();
    expect(result).toMatchObject({ imported: 1, updated: 1, removed: 1, errors: [] });
    expect(fixture.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'shared',
          name: 'SHARED-VDI',
          owner: 'Platform',
          comment: 'Keep',
          custom: 'preserved',
        }),
        expect.objectContaining({ name: 'NEW-SHARED' }),
      ]),
    );
    expect(fixture.rows.some((row) => row.id === 'user')).toBe(false);
    expect(fixture.calls).toEqual(['save', 'delete']);
  });

  it('does not rewrite unchanged servers or imported metadata', async () => {
    const plan = await prepareServerSync(
      file([
        { id: 'wrong-id', name: ' SHARED-VDI ', owner: 'Ops', updated: 'wrong' },
        { name: 'USER-VDI' },
      ]),
    );
    expect(plan.unchanged).toBe(2);
    expect(await plan.apply()).toMatchObject({
      imported: 0,
      updated: 0,
      removed: 0,
      unchanged: 2,
      errors: [],
    });
    expect(fixture.calls).toEqual([]);
    expect(fixture.rows[0]).toMatchObject({ id: 'shared', updated: 'before' });
  });

  it.each(
    [
      [],
      [{ name: '' }],
      [{ name: ' ' }],
      [{ name: 23 }],
      [{ name: 'A' }, { name: ' a ' }],
      [{ name: 'Contact', email: 'person@example.test' }],
      [{ name: 'A', owner: { nested: 'bad' } }],
    ].map((rows) => ({ rows })),
  )('rejects invalid or ambiguous complete lists before writes: $rows', async ({ rows }) => {
    await expect(prepareServerSync(file(rows))).rejects.toThrow(
      /empty|name|duplicate|column|text|record/i,
    );
    expect(fixture.calls).toEqual([]);
  });

  it('rejects duplicate names already in Relay', async () => {
    fixture.rows.push(server('duplicate', 'shared-vdi'));
    await expect(prepareServerSync(file([{ name: 'SHARED-VDI' }]))).rejects.toThrow(
      /ambiguous|duplicate/i,
    );
    expect(fixture.calls).toEqual([]);
  });

  it('rejects a stale preview before saving or deleting anything', async () => {
    const plan = await prepareServerSync(file([{ name: 'SHARED-VDI', owner: 'New' }]));
    fixture.rows[1]!.comment = 'Someone edited this';
    await expect(plan.apply()).rejects.toThrow(/changed|preview/i);
    expect(fixture.calls).toEqual([]);
  });

  it('rejects switching connections after preview', async () => {
    const plan = await prepareServerSync(file([{ name: 'SHARED-VDI' }]));
    fixture.client = makeClient();
    await expect(plan.apply()).rejects.toThrow(/connection|preview/i);
    expect(fixture.calls).toEqual([]);
  });

  it.each(['connection', 'account'])(
    'stops writes if the %s changes during a snapshot read',
    async (change) => {
      const plan = await prepareServerSync(file([{ name: 'SHARED-VDI' }]));
      let reads = 0;
      fixture.onRead = () => {
        if (++reads < 2) return;
        if (change === 'connection') fixture.client = makeClient();
        else (fixture.client as ReturnType<typeof makeClient>).authStore.token = 'different';
      };
      const result = await plan.apply();
      expect(result.errors.join(' ')).toMatch(/connection|account/i);
      expect(fixture.calls).toEqual([]);
    },
  );

  it('never deletes omitted rows when a save fails', async () => {
    const plan = await prepareServerSync(file([{ name: 'SHARED-VDI', owner: 'New' }]));
    fixture.failSave = true;
    const result = await plan.apply();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.removed).toBe(0);
    expect(fixture.calls).toEqual(['save']);
    expect(fixture.rows.some((row) => row.id === 'user')).toBe(true);
  });

  it('rechecks the directory before removing anything after saving changes', async () => {
    const plan = await prepareServerSync(file([{ name: 'SHARED-VDI', owner: 'New' }]));
    fixture.mutateAfterSave = true;
    const result = await plan.apply();
    expect(result).toMatchObject({ updated: 1, removed: 0 });
    expect(result.errors.join(' ')).toMatch(/changed|preview/i);
    expect(fixture.calls).toEqual(['save']);
    expect(fixture.rows.some((row) => row.id === 'user')).toBe(true);
  });

  it('reports a rejected deletion and never silently retries the plan', async () => {
    const plan = await prepareServerSync(file([{ name: 'SHARED-VDI' }]));
    fixture.failDelete = true;
    const result = await plan.apply();
    expect(result.removed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    await expect(plan.apply()).rejects.toThrow(/preview|already/i);
    expect(fixture.calls).toEqual(['delete']);
  });

  it('requires an online connection for preview and apply', async () => {
    fixture.online = false;
    await expect(prepareServerSync(file([{ name: 'SHARED-VDI' }]))).rejects.toThrow(/Offline/);
    fixture.online = true;
    const plan = await prepareServerSync(file([{ name: 'SHARED-VDI' }]));
    fixture.online = false;
    await expect(plan.apply()).rejects.toThrow(/Offline/);
    expect(fixture.calls).toEqual([]);
  });
});
