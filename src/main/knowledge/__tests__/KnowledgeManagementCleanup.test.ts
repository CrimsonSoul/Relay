import { describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_UPLOADS_COLLECTION,
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
} from '@shared/knowledge';
import { KnowledgeManagementCleanup } from '../KnowledgeManagementCleanup';

const NOW = Date.parse('2026-07-16T01:00:00.000Z');
const OLD = '2026-07-01T00:00:00.000Z';
type RecordValue = Record<string, unknown> & { id: string };
function harness(initial: Record<string, RecordValue[]>) {
  const records = new Map(
    Object.entries(initial).map(([name, values]) => [
      name,
      new Map(values.map((value) => [value.id, { ...value }])),
    ]),
  );
  const writes: string[] = [];
  let failUpload: string | null = null;
  const rows = (name: string) => {
    let values = records.get(name);
    if (!values) {
      values = new Map();
      records.set(name, values);
    }
    return values;
  };
  const collection = vi.fn((name: string) => ({
    getFullList: vi.fn(async (options: { filter?: string } = {}) =>
      [...rows(name).values()].filter((value) => {
        if (options.filter?.startsWith('expiresAt'))
          return Date.parse(String(value.expiresAt)) < NOW;
        if (options.filter?.startsWith('occurredAt'))
          return Date.parse(String(value.occurredAt)) < NOW - 365 * 86400000;
        if (options.filter?.startsWith('uploadId'))
          return options.filter.includes(`"${value.uploadId}"`);
        return true;
      }),
    ),
    getOne: vi.fn(async (id: string) => ({ ...rows(name).get(id) })),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const result = { ...rows(name).get(id), ...patch, id };
      rows(name).set(id, result);
      writes.push(`update:${name}:${id}`);
      return result;
    }),
    delete: vi.fn(async (id: string) => {
      rows(name).delete(id);
      writes.push(`delete:${name}:${id}`);
      return true;
    }),
  }));
  const createBatch = () => {
    const operations: Array<
      | { kind: 'create'; name: string; value: Record<string, unknown> }
      | { kind: 'delete'; name: string; id: string }
    > = [];
    return {
      collection: (name: string) => ({
        create: (value: Record<string, unknown>) =>
          operations.push({ kind: 'create', name, value }),
        delete: (id: string) => operations.push({ kind: 'delete', name, id }),
      }),
      send: async () => {
        if (failUpload && rows(KNOWLEDGE_UPLOADS_COLLECTION).has(failUpload)) {
          failUpload = null;
          throw new Error('transient write failure');
        }
        for (const operation of operations) {
          const { name } = operation;
          if (operation.kind === 'create') {
            const id = `audit-${rows(name).size}`;
            rows(name).set(id, { ...operation.value, id });
            writes.push(`create:${name}:${id}`);
          } else {
            const { id } = operation;
            if (
              name === KNOWLEDGE_UPLOADS_COLLECTION &&
              [...rows(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION).values()].some(
                (chunk) => chunk.uploadId === id,
              )
            )
              throw new Error('required chunk relation');
            rows(name).delete(id);
            writes.push(`delete:${name}:${id}`);
          }
        }
        return operations.map(() => ({ status: 200 }));
      },
    };
  };
  return {
    pb: {
      collection,
      createBatch,
      filter: (_pattern: string, values: { uploadId: string }) => `uploadId = "${values.uploadId}"`,
    } as never,
    rows,
    writes,
    collection,
    failNext: () => {
      failUpload = 'first';
    },
  };
}
function upload(id: string, overrides: Record<string, unknown> = {}): RecordValue {
  return {
    id,
    batchId: 'batch',
    requestId: `request-${id}`,
    fileName: `${id}.pdf`,
    accountId: 'account-1',
    actorDisplayName: 'Ryan Bledsoe',
    state: 'ready',
    expiresAt: OLD,
    revision: 1,
    ...overrides,
  };
}
function batch(id = 'batch'): RecordValue {
  return { id, state: 'active', expiresAt: OLD, revision: 1 };
}

describe('KnowledgeManagementCleanup', () => {
  it('expires the complete staging graph including empty abandoned batches and never purges trash', async () => {
    const fixture = harness({
      [KNOWLEDGE_UPLOAD_BATCHES_COLLECTION]: [batch(), batch('empty')],
      [KNOWLEDGE_UPLOADS_COLLECTION]: [
        upload('unfinished', { state: 'uploading' }),
        upload('published', { state: 'published' }),
      ],
      [KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION]: [
        { id: 'chunk', uploadId: 'unfinished', batchId: 'batch' },
      ],
    });
    const result = await new KnowledgeManagementCleanup({ pb: fixture.pb, now: () => NOW }).run();
    expect(result.expiredUploads).toBe(2);
    expect(fixture.rows(KNOWLEDGE_UPLOADS_COLLECTION).size).toBe(0);
    expect(fixture.rows(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION).size).toBe(0);
    expect(fixture.rows(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION).get('empty')?.state).toBe('expired');
    expect([...fixture.rows(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).values()]).toEqual([
      expect.objectContaining({
        action: 'upload-expired',
        accountId: 'account-1',
        actorDisplayName: 'Ryan Bledsoe',
        operatorId: '',
        operatorName: '',
      }),
    ]);
    expect(fixture.collection).not.toHaveBeenCalledWith(KNOWLEDGE_DOCUMENTS_COLLECTION);
  });
  it('preserves historical attribution and retains one year of audits', async () => {
    const fixture = harness({
      [KNOWLEDGE_UPLOADS_COLLECTION]: [
        upload('legacy', { actorDisplayName: '', operatorName: 'Legacy Publisher' }),
      ],
      [KNOWLEDGE_AUDIT_EVENTS_COLLECTION]: [
        { id: 'old', occurredAt: '2024-07-01T00:00:00.000Z' },
        { id: 'recent', occurredAt: '2026-07-01T00:00:00.000Z' },
      ],
    });
    await new KnowledgeManagementCleanup({ pb: fixture.pb, now: () => NOW }).run();
    expect(fixture.rows(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).has('old')).toBe(false);
    expect(fixture.rows(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).has('recent')).toBe(true);
    expect([...fixture.rows(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).values()]).toContainEqual(
      expect.objectContaining({ actorDisplayName: 'Legacy Publisher' }),
    );
  });
  it('rechecks retention inside the upload mutation lock and preserves newly ready work', async () => {
    const fixture = harness({
      [KNOWLEDGE_UPLOAD_BATCHES_COLLECTION]: [batch()],
      [KNOWLEDGE_UPLOADS_COLLECTION]: [upload('extended')],
    });
    await new KnowledgeManagementCleanup({
      pb: fixture.pb,
      now: () => NOW,
      withStagingMutation: async (key, action) => {
        if (key === 'upload:extended')
          fixture.rows(KNOWLEDGE_UPLOADS_COLLECTION).get('extended')!.expiresAt =
            '2026-07-23T00:00:00.000Z';
        return action();
      },
    }).run();
    expect(fixture.rows(KNOWLEDGE_UPLOADS_COLLECTION).has('extended')).toBe(true);
    expect(fixture.rows(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).size).toBe(0);
  });
  it('continues after a failed upload transaction and retries it without duplicate audits', async () => {
    const fixture = harness({
      [KNOWLEDGE_UPLOADS_COLLECTION]: [upload('first'), upload('second')],
    });
    fixture.failNext();
    const cleanup = new KnowledgeManagementCleanup({ pb: fixture.pb, now: () => NOW });
    expect((await cleanup.run()).expiredUploads).toBe(1);
    expect(fixture.rows(KNOWLEDGE_UPLOADS_COLLECTION).has('first')).toBe(true);
    expect((await cleanup.run()).expiredUploads).toBe(1);
    expect(fixture.rows(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).size).toBe(2);
  });
});
