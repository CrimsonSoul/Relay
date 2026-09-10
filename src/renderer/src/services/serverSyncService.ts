import type PocketBase from 'pocketbase';
import { getPb, requireOnline } from './pocketbase';
import {
  MAX_IMPORT_RECORDS,
  parseCsvRecords,
  parseExcelRecords,
  parseJsonRecords,
} from './importFileParser';

const BATCH_SIZE = 100;
const TEXT_FIELDS = new Set(['name', 'businessArea', 'lob', 'comment', 'owner', 'contact', 'os']);
const METADATA = new Set([
  'id',
  'created',
  'updated',
  'createdAt',
  'updatedAt',
  'collectionId',
  'collectionName',
  'expand',
]);
type Row = Record<string, unknown> & { id: string; name: string };
type Save = { id?: string; name: string; data: Record<string, unknown> };

export type ServerSyncFile = { name: string; text: string; buffer: ArrayBuffer };
export type ServerSyncResult = {
  imported: number;
  updated: number;
  removed: number;
  unchanged: number;
  errors: string[];
  outcomeUncertain: boolean;
};
export type ServerSyncProgress = {
  stage: 'saving' | 'removing';
  processed: number;
  total: number;
  imported: number;
  updated: number;
  removed: number;
};
type ProgressCallback = (progress: ServerSyncProgress) => void;
export type ServerSyncPlan = {
  fileName: string;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
  incomingCount: number;
  currentCount: number;
  backupJson: string;
  apply: (onProgress?: ProgressCallback) => Promise<ServerSyncResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nameKey(record: Record<string, unknown>): string {
  if (typeof record.name !== 'string' || !record.name.trim()) {
    throw new Error(
      'Every server record requires a non-empty name. Use a complete Servers export.',
    );
  }
  return record.name.trim().toLowerCase();
}

function indexNames<T extends Record<string, unknown>>(
  records: T[],
  source: string,
): Map<string, T> {
  const byName = new Map<string, T>();
  for (const record of records) {
    if (!isRecord(record)) throw new Error(`${source} contains an invalid server record.`);
    const key = nameKey(record);
    if (byName.has(key))
      throw new Error(
        `${source} contains duplicate server name "${record.name}". Resolve ambiguous names before syncing.`,
      );
    byName.set(key, record);
  }
  return byName;
}

function snapshot(records: Iterable<Record<string, unknown>>): string {
  const sorted = [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify(sorted, (_key, value: unknown) => {
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== 'expand')
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, value[key]]),
    );
  });
}

async function readServers(pb: PocketBase): Promise<Row[]> {
  const rows = await pb.collection('servers').getFullList<Row>({ batch: 500, requestKey: null });
  if (rows.length > MAX_IMPORT_RECORDS)
    throw new Error(`Sync supports at most ${MAX_IMPORT_RECORDS} existing servers.`);
  if (rows.some((row) => typeof row.id !== 'string' || !row.id))
    throw new Error('Relay returned an invalid server record. Refresh the preview.');
  return structuredClone(rows);
}

async function parseFile(file: ServerSyncFile) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return parseExcelRecords('servers', file.buffer);
  if (name.endsWith('.csv')) return parseCsvRecords(file.text);
  if (name.endsWith('.json')) return parseJsonRecords('servers', file.text);
  throw new Error('Choose a JSON, CSV, or XLSX Servers export.');
}

function serverData(
  record: Record<string, unknown>,
  allowed: Set<string>,
  existing?: Row,
): Record<string, unknown> {
  const entries = Object.entries(record).filter(([key]) => !METADATA.has(key));
  for (const [key, value] of entries) {
    if (!allowed.has(key))
      throw new Error(`Unrecognized server column "${key}". Use a Servers export.`);
    if (TEXT_FIELDS.has(key) && value !== null && typeof value !== 'string')
      throw new Error(`Server column "${key}" must contain text.`);
  }
  const data = Object.fromEntries(
    entries.map(([key, value]) => [key, TEXT_FIELDS.has(key) && value === null ? '' : value]),
  );
  data.name = existing?.name ?? String(record.name).trim();
  return data;
}

function makeChanges(incoming: Map<string, Record<string, unknown>>, existing: Row[]) {
  const current = indexNames(existing, 'The current Servers list');
  const allowed = new Set([...TEXT_FIELDS, ...existing.flatMap((row) => Object.keys(row))]);
  const saves: Save[] = [];
  let unchanged = 0;
  for (const [key, row] of incoming) {
    const matched = current.get(key);
    const data = serverData(row, allowed, matched);
    if (!matched) saves.push({ name: String(data.name), data });
    else {
      const patch = Object.fromEntries(
        Object.entries(data).filter(
          ([field, value]) => JSON.stringify(value) !== JSON.stringify(matched[field]),
        ),
      );
      if (Object.keys(patch).length)
        saves.push({ id: matched.id, name: matched.name, data: patch });
      else unchanged++;
    }
  }
  return { saves, unchanged, removals: existing.filter((row) => !incoming.has(nameKey(row))) };
}

function checkConnection(pb: PocketBase, token: string): void {
  requireOnline();
  if (getPb() !== pb || pb.authStore.token !== token)
    throw new Error('The Relay connection or account changed. Create a fresh sync preview.');
}

async function verifySnapshot(pb: PocketBase, expected: Map<string, Row>): Promise<void> {
  if (snapshot(await readServers(pb)) !== snapshot(expected.values())) {
    throw new Error(
      'The Servers list changed after the preview. No further changes were made. Create a fresh preview.',
    );
  }
}

function confirmedRejection(error: unknown): boolean {
  if (!isRecord(error) && !(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function queueSaves(pb: PocketBase, saves: Save[]) {
  const batch = pb.createBatch();
  for (const save of saves) {
    if (save.id) batch.collection('servers').update(save.id, save.data);
    else batch.collection('servers').create(save.data);
  }
  return batch;
}

function validateResponses(
  responses: { status: number; body: unknown }[],
  count: number,
  saving: boolean,
): void {
  if (
    responses.length !== count ||
    responses.some(
      ({ status, body }) =>
        status < 200 ||
        status >= 300 ||
        (saving && (!isRecord(body) || typeof body.id !== 'string')),
    )
  )
    throw new Error(`Could not confirm the ${saving ? 'saved' : 'removed'} server records.`);
}

async function applyChanges(
  pb: PocketBase,
  token: string,
  existing: Row[],
  changes: ReturnType<typeof makeChanges>,
  onProgress?: ProgressCallback,
): Promise<ServerSyncResult> {
  checkConnection(pb, token);
  const expected = new Map(existing.map((row) => [row.id, row]));
  await verifySnapshot(pb, expected);
  const result: ServerSyncResult = {
    imported: 0,
    updated: 0,
    removed: 0,
    unchanged: changes.unchanged,
    errors: [],
    outcomeUncertain: false,
  };
  let pendingBatch = false;
  const emit = (stage: ServerSyncProgress['stage']): void =>
    onProgress?.({
      stage,
      processed: result.imported + result.updated + result.removed,
      total: changes.saves.length + changes.removals.length,
      imported: result.imported,
      updated: result.updated,
      removed: result.removed,
    });
  try {
    emit('saving');
    for (let offset = 0; offset < changes.saves.length; offset += BATCH_SIZE) {
      checkConnection(pb, token);
      if (offset) await verifySnapshot(pb, expected);
      const saves = changes.saves.slice(offset, offset + BATCH_SIZE);
      const batch = queueSaves(pb, saves);
      checkConnection(pb, token);
      pendingBatch = true;
      const responses = await batch.send({ requestKey: null });
      validateResponses(responses, saves.length, true);
      pendingBatch = false;
      responses.forEach(({ body }, index) => {
        const row = structuredClone(body) as Row;
        expected.set(row.id, row);
        if (saves[index]!.id) result.updated++;
        else result.imported++;
      });
      emit('saving');
    }
    for (let offset = 0; offset < changes.removals.length; offset += BATCH_SIZE) {
      checkConnection(pb, token);
      await verifySnapshot(pb, expected);
      const removals = changes.removals.slice(offset, offset + BATCH_SIZE);
      const batch = pb.createBatch();
      for (const row of removals) batch.collection('servers').delete(row.id);
      emit('removing');
      checkConnection(pb, token);
      pendingBatch = true;
      const responses = await batch.send({ requestKey: null });
      validateResponses(responses, removals.length, false);
      pendingBatch = false;
      for (const row of removals) expected.delete(row.id);
      result.removed += removals.length;
      emit('removing');
    }
    checkConnection(pb, token);
    await verifySnapshot(pb, expected);
    checkConnection(pb, token);
  } catch (error) {
    result.outcomeUncertain = pendingBatch && !confirmedRejection(error);
    result.errors.push(error instanceof Error ? error.message : 'Server sync failed.');
    if (result.outcomeUncertain)
      result.errors.push(
        'The last batch may have applied. Counts include confirmed changes only. Refresh the preview before retrying.',
      );
  }
  return result;
}

/** Preview a complete Servers list without writing. Apply is deliberately single-use. */
export async function prepareServerSync(file: ServerSyncFile): Promise<ServerSyncPlan> {
  requireOnline();
  const parsed = await parseFile(file);
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  if (!parsed.records.length)
    throw new Error(
      'An empty file cannot replace the Servers list. Include every server you want to keep.',
    );
  if (parsed.records.length > MAX_IMPORT_RECORDS)
    throw new Error(`Sync supports at most ${MAX_IMPORT_RECORDS} records.`);
  if (parsed.headers && new Set(parsed.headers).size !== parsed.headers.length)
    throw new Error('The file contains duplicate column headers.');
  const incoming = indexNames(parsed.records, 'The import file');
  const pb = getPb();
  const token = pb.authStore.token;
  const existing = await readServers(pb);
  checkConnection(pb, token);
  const changes = makeChanges(incoming, existing);
  let consumed = false;
  return {
    fileName: file.name,
    added: changes.saves.filter((save) => !save.id).map((save) => save.name),
    updated: changes.saves.filter((save) => save.id).map((save) => save.name),
    removed: changes.removals.map((row) => row.name),
    unchanged: changes.unchanged,
    incomingCount: incoming.size,
    currentCount: existing.length,
    backupJson: JSON.stringify(existing, null, 2),
    apply: async (onProgress) => {
      if (consumed)
        throw new Error('This sync preview has already been used. Create a fresh preview.');
      consumed = true;
      return applyChanges(pb, token, existing, changes, onProgress);
    },
  };
}
