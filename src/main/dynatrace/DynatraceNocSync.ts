import type PocketBase from 'pocketbase';
import {
  DYNATRACE_NOC_ACK_EVENT_TYPE,
  DYNATRACE_NOC_ANALYSTS_LOOKUP_PATH,
  DYNATRACE_NOC_EVENT_PROVIDER,
  DYNATRACE_NOC_NOTE_EVENT_TYPE,
  DYNATRACE_NOC_OAUTH_SCOPES,
  DYNATRACE_NOC_SOURCE,
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_KEY,
  MAX_DYNATRACE_NOC_NOTE_LENGTH,
  normalizeDynatraceNocAnalysts,
  type DynatraceNocAnalyst,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../logger';
import { dynatraceAuthentication } from './DynatraceAuthentication';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';

const INGEST_PATH = '/platform/classic/environment-api/v2/bizevents/ingest';
const REQUEST_TIMEOUT_MS = 15_000;
const SEND_BATCH_SIZE = 100;
/** RELAY-SYNC outbox backoff: 30s, 1m, 2m, then every 5m. */
const SEND_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000] as const;
/** Grail ingest can land late, so each read starts five minutes before the cursor. */
const PULL_OVERLAP_MS = 5 * 60_000;
/** The notes bucket's retention, read on the first run. */
const PULL_INITIAL_TIMEFRAME = '-35d';
const ROSTER_REFRESH_MS = 15 * 60_000;
const MAX_FIELD_LENGTH = 512;
const MAX_LIST_LENGTH = 500;

type Query = (
  config: DynatraceProblemsConfig,
  query: string,
  signal?: AbortSignal,
  scopes?: readonly string[],
) => Promise<Record<string, unknown>[]>;

type NocEvent = Record<string, string | string[]>;
type ProblemKeys = { problemId: string; displayId: string; affectedEntities?: { id: string }[] };

type IncomingRecord = {
  type: typeof DYNATRACE_NOC_NOTE_EVENT_TYPE | typeof DYNATRACE_NOC_ACK_EVENT_TYPE;
  recordId: string;
  timestamp: number;
  displayIds: string[];
  analyst: string;
  analystName: string;
  enteredBy: string;
  source: string;
  text: string;
  state: string;
  noteId: string;
  scopeEntities: string[];
};

class RejectedBatchError extends Error {}

function text(value: unknown, max = MAX_FIELD_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Grail returns list fields as JSON text; fall back to commas (Infra Health's `strings()`). */
export function parseNocStrings(value: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      items = value.split(',');
    }
  }
  return [...new Set(items.map((item) => text(item)).filter(Boolean))].slice(0, MAX_LIST_LENGTH);
}

/** Grail returns nanosecond ISO timestamps; PocketBase uses a space separator. */
export function parseNocTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const normalized = value.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIncomingNocRecord(record: Record<string, unknown>): IncomingRecord | null {
  const type = record['event.type'];
  if (type !== DYNATRACE_NOC_NOTE_EVENT_TYPE && type !== DYNATRACE_NOC_ACK_EVENT_TYPE) return null;
  const recordId = text(record.record_id, 128);
  const timestamp = parseNocTimestamp(record.timestamp);
  const displayIds = [
    ...new Set([text(record.display_id), ...parseNocStrings(record.display_ids)].filter(Boolean)),
  ];
  if (!recordId || timestamp === null || !displayIds.length) return null;
  return {
    type,
    recordId,
    timestamp,
    displayIds,
    analyst: text(record.analyst, 254).toLowerCase(),
    analystName: text(record.analyst_name, 254),
    enteredBy: text(record.entered_by, 256),
    source: text(record.source, 64),
    text: text(record.text, MAX_DYNATRACE_NOC_NOTE_LENGTH),
    state: text(record.state, 32),
    noteId: text(record.note_id, 128),
    scopeEntities: parseNocStrings(record.scope_entities),
  };
}

/** RELAY-SYNC section 4: newest record per id since the cursor. */
export function buildNocPullQuery(cursorMs: number | null): string {
  const from =
    cursorMs === null
      ? PULL_INITIAL_TIMEFRAME
      : `toTimestamp("${new Date(cursorMs - PULL_OVERLAP_MS).toISOString()}")`;
  return `fetch bizevents, from: ${from}
| filter in(event.type, {"${DYNATRACE_NOC_NOTE_EVENT_TYPE}", "${DYNATRACE_NOC_ACK_EVENT_TYPE}"})
| fieldsAdd record_id = if(event.type == "${DYNATRACE_NOC_NOTE_EVENT_TYPE}", note_id, else: ack_id)
| filterOut isNull(record_id)
| sort timestamp desc
| dedup { event.type, record_id }
| fields timestamp, event.type, record_id, display_id, display_ids, site, analyst, analyst_name,
    entered_by, source, text, state, note_id, scope_entities, scope_status`;
}

const ROSTER_QUERY = `load "${DYNATRACE_NOC_ANALYSTS_LOOKUP_PATH}"
| filter active == "true"
| fields email, name
| sort name asc`;

/**
 * Keeps Relay's NOC notes, acks and analyst roster in step with Grail, which is the master that
 * Infra Health also reads and writes. Renderers save rows as `sync: pending`; those rows are the
 * outbox, sent in one ingest batch at the start of each problem poll.
 */
export class DynatraceNocSync {
  private inFlight: Promise<void> | null = null;
  private sendAttempts = 0;
  private nextSendAt = 0;
  private sendError = '';
  private nextRosterAt = 0;

  constructor(
    private readonly query: Query,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  reset(): void {
    this.sendAttempts = 0;
    this.nextSendAt = 0;
    this.sendError = '';
    this.nextRosterAt = 0;
  }

  idle(): Promise<void> {
    return this.inFlight?.catch(() => undefined) ?? Promise.resolve();
  }

  run(pb: PocketBase, config: DynatraceProblemsConfig): Promise<void> {
    if (!config.oauth) return Promise.resolve();
    this.inFlight ??= this.cycle(pb, config).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async cycle(pb: PocketBase, config: DynatraceProblemsConfig): Promise<void> {
    const sync = (
      await pb
        .collection(DYNATRACE_PROBLEM_SYNC_COLLECTION)
        .getList<DynatraceProblemSyncRecord>(1, 1, {
          filter: pb.filter('key = {:key}', { key: DYNATRACE_PROBLEM_SYNC_KEY }),
          requestKey: null,
        })
    ).items[0];
    const errors: string[] = [];
    const patch: Partial<DynatraceProblemSyncRecord> = {};

    if (this.now() >= this.nextSendAt) await this.flushOutbox(pb, config);
    if (this.sendError) errors.push(this.sendError);

    await this.pull(pb, config, parseNocTimestamp(sync?.nocCursor))
      .then((cursor) => {
        if (cursor !== null) patch.nocCursor = new Date(cursor).toISOString();
      })
      .catch((error) => {
        errors.push(`Reading NOC notes from Dynatrace failed: ${getErrorMessage(error)}`);
      });

    if (this.now() >= this.nextRosterAt) {
      this.nextRosterAt = this.now() + ROSTER_REFRESH_MS;
      await this.readRoster(config)
        .then((analysts) => {
          patch.nocAnalysts = analysts;
        })
        .catch((error) => {
          errors.push(`Reading the Dynatrace analyst roster failed: ${getErrorMessage(error)}`);
        });
    }

    patch.nocPendingCount = await this.pendingCount(pb);
    patch.nocSyncError = errors.join(' ');
    if (!patch.nocSyncError) patch.nocSyncedAt = new Date(this.now()).toISOString();
    await this.writeStatus(pb, sync, patch);
  }

  private async flushOutbox(pb: PocketBase, config: DynatraceProblemsConfig): Promise<void> {
    const [notes, states] = await Promise.all([
      pb
        .collection(DYNATRACE_PROBLEM_NOTES_COLLECTION)
        .getList<DynatraceProblemNoteRecord>(1, SEND_BATCH_SIZE, {
          filter: 'sync = "pending"',
          sort: 'created',
          requestKey: null,
        }),
      pb
        .collection(DYNATRACE_PROBLEM_STATES_COLLECTION)
        .getList<DynatraceProblemStateRecord>(1, SEND_BATCH_SIZE, {
          filter: 'sync = "pending"',
          sort: 'updated',
          requestKey: null,
        }),
    ]);
    if (!notes.items.length && !states.items.length) {
      this.sendAttempts = 0;
      this.sendError = '';
      return;
    }

    const problems = await this.problemsById(pb, [
      ...notes.items.map((note) => note.problemId),
      ...states.items.map((state) => state.problemId),
    ]);
    const unsendable = (problemId: string) => !problems.get(problemId)?.displayId;
    const sendableNotes = notes.items.filter((note) => !unsendable(note.problemId));
    const sendableStates = states.items.filter((state) => !unsendable(state.problemId));
    await this.markError(
      pb,
      [
        ...notes.items
          .filter((note) => unsendable(note.problemId))
          .map((note) => [DYNATRACE_PROBLEM_NOTES_COLLECTION, note.id] as const),
        ...states.items
          .filter((state) => unsendable(state.problemId))
          .map((state) => [DYNATRACE_PROBLEM_STATES_COLLECTION, state.id] as const),
      ],
      'Relay no longer has this problem, so the record was kept locally and not sent.',
    );

    const events = [
      ...noteEvents(sendableNotes, problems),
      ...sendableStates.map((state) => ackEvent(state, problems.get(state.problemId)!)),
    ];
    if (!events.length) return;
    try {
      await this.ingest(config, events);
    } catch (error) {
      if (error instanceof RejectedBatchError) {
        // Not retryable: keep the records, tell the analyst, and stop resending them.
        this.sendAttempts = 0;
        this.sendError = '';
        await this.markError(
          pb,
          [
            ...sendableNotes.map((note) => [DYNATRACE_PROBLEM_NOTES_COLLECTION, note.id] as const),
            ...sendableStates.map(
              (state) => [DYNATRACE_PROBLEM_STATES_COLLECTION, state.id] as const,
            ),
          ],
          `${error.message} The record was kept in Relay.`,
        );
        return;
      }
      this.sendAttempts += 1;
      this.nextSendAt =
        this.now() + SEND_BACKOFF_MS[Math.min(this.sendAttempts, SEND_BACKOFF_MS.length) - 1]!;
      this.sendError = `Sending NOC notes to Dynatrace failed; retrying: ${getErrorMessage(error)}`;
      return;
    }
    this.sendAttempts = 0;
    this.sendError = '';

    for (const note of sendableNotes) {
      await pb
        .collection(DYNATRACE_PROBLEM_NOTES_COLLECTION)
        .update(note.id, { sync: 'synced', syncError: '' }, { requestKey: null });
    }
    for (const state of sendableStates) {
      // A workstation may have acked or cleared again while this batch was in flight.
      const current = await pb
        .collection(DYNATRACE_PROBLEM_STATES_COLLECTION)
        .getOne<DynatraceProblemStateRecord>(state.id, { requestKey: null });
      if (current.ackId !== state.ackId) continue;
      await pb
        .collection(DYNATRACE_PROBLEM_STATES_COLLECTION)
        .update(state.id, { sync: 'synced', syncError: '' }, { requestKey: null });
    }
    loggers.main.info('Sent NOC notes and acks to Dynatrace', {
      notes: sendableNotes.length,
      acks: sendableStates.length,
    });
  }

  private async markError(
    pb: PocketBase,
    rows: (readonly [string, string])[],
    message: string,
  ): Promise<void> {
    for (const [collection, id] of rows) {
      await pb
        .collection(collection)
        .update(id, { sync: 'error', syncError: message }, { requestKey: null });
    }
  }

  private async ingest(config: DynatraceProblemsConfig, events: NocEvent[]): Promise<void> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const authentication = dynatraceAuthentication(this.fetchImpl);
    const token = await authentication.token(config, signal, DYNATRACE_NOC_OAUTH_SCOPES);
    const response = await this.fetchImpl(new URL(INGEST_PATH, config.environmentUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(events),
      redirect: 'error',
      signal,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return;
    if (response.status === 401) authentication.clear();
    const message = `Dynatrace rejected the NOC records (HTTP ${response.status}).`;
    // 401/403 usually mean the OAuth client lacks storage:events:write; retry once it is fixed.
    const retryable =
      response.status >= 500 ||
      response.status === 429 ||
      response.status === 401 ||
      response.status === 403;
    throw retryable ? new Error(message) : new RejectedBatchError(message);
  }

  /** Imports newer records and returns the new cursor (largest Grail timestamp), if any. */
  private async pull(
    pb: PocketBase,
    config: DynatraceProblemsConfig,
    cursor: number | null,
  ): Promise<number | null> {
    const records = (await this.query(config, buildNocPullQuery(cursor)))
      .map(parseIncomingNocRecord)
      .filter((record): record is IncomingRecord => record !== null);
    const problems = await this.problemsByDisplayId(
      pb,
      records.flatMap((record) => record.displayIds),
    );
    let imported = 0;
    for (const record of records) {
      const changed =
        record.type === DYNATRACE_NOC_NOTE_EVENT_TYPE
          ? await this.upsertNote(pb, record, problems)
          : await this.upsertAck(pb, record, problems);
      imported += changed;
    }
    if (imported) loggers.main.info('Imported NOC notes and acks from Dynatrace', { imported });
    const latest = Math.max(...records.map((record) => record.timestamp));
    return Number.isFinite(latest) && latest > (cursor ?? 0) ? latest : null;
  }

  private async upsertNote(
    pb: PocketBase,
    record: IncomingRecord,
    problems: Map<string, ProblemKeys>,
  ): Promise<number> {
    const notes = pb.collection(DYNATRACE_PROBLEM_NOTES_COLLECTION);
    const problemIds = [
      ...new Set(record.displayIds.map((id) => problems.get(id)?.problemId).filter(Boolean)),
    ] as string[];
    let changed = 0;
    for (const problemId of problemIds) {
      const existing = (
        await notes.getList<DynatraceProblemNoteRecord>(1, 1, {
          filter: pb.filter('noteId = {:noteId} && problemId = {:problemId}', {
            noteId: record.recordId,
            problemId,
          }),
          // An edit or delete made in Relay is a newer row; that row is the one shown.
          sort: '-created',
          requestKey: null,
        })
      ).items[0];
      const storedTs = parseNocTimestamp(existing?.grailTs);
      if (storedTs !== null && storedTs >= record.timestamp) continue;
      // A local note not yet sent only yields to a version written after the one it replaced.
      if (existing?.sync === 'pending' && storedTs === null) continue;
      const payload = {
        problemId,
        noteId: record.recordId,
        note: record.text || existing?.note || '(empty note)',
        author: record.analystName,
        analyst: record.analyst,
        enteredBy: record.enteredBy,
        source: record.source,
        state: record.state === 'deleted' ? 'deleted' : 'active',
        displayIds: record.displayIds,
        grailTs: new Date(record.timestamp).toISOString(),
        sync: 'synced',
        syncError: '',
      };
      if (existing) await notes.update(existing.id, payload, { requestKey: null });
      else await notes.create(payload, { requestKey: null });
      changed += 1;
    }
    return changed;
  }

  private async upsertAck(
    pb: PocketBase,
    record: IncomingRecord,
    problems: Map<string, ProblemKeys>,
  ): Promise<number> {
    const problemId = problems.get(record.displayIds[0]!)?.problemId;
    if (!problemId) return 0;
    const states = pb.collection(DYNATRACE_PROBLEM_STATES_COLLECTION);
    const existing = (
      await states.getList<DynatraceProblemStateRecord>(1, 1, {
        filter: pb.filter('problemId = {:problemId}', { problemId }),
        requestKey: null,
      })
    ).items[0];
    if (existing && !acceptsIncomingAck(existing, record)) return 0;
    const addressed = record.state === 'addressed';
    const payload = {
      problemId,
      addressed,
      ackState: addressed ? 'addressed' : 'cleared',
      ackId: record.recordId,
      addressedAt: addressed ? new Date(record.timestamp).toISOString() : '',
      addressedBy: addressed ? record.analystName : '',
      analyst: record.analyst,
      enteredBy: record.enteredBy,
      source: record.source,
      noteId: record.noteId,
      scopeEntities: record.scopeEntities,
      grailTs: new Date(record.timestamp).toISOString(),
      sync: 'synced',
      syncError: '',
    };
    if (existing) await states.update(existing.id, payload, { requestKey: null });
    else await states.create(payload, { requestKey: null });
    return 1;
  }

  private async readRoster(config: DynatraceProblemsConfig): Promise<DynatraceNocAnalyst[]> {
    const records = await this.query(config, ROSTER_QUERY, undefined, DYNATRACE_NOC_OAUTH_SCOPES);
    return normalizeDynatraceNocAnalysts(records);
  }

  private async pendingCount(pb: PocketBase): Promise<number> {
    const [notes, states] = await Promise.all(
      [DYNATRACE_PROBLEM_NOTES_COLLECTION, DYNATRACE_PROBLEM_STATES_COLLECTION].map((collection) =>
        pb.collection(collection).getList(1, 1, {
          filter: 'sync = "pending"',
          fields: 'id',
          requestKey: null,
        }),
      ),
    );
    return (notes?.totalItems ?? 0) + (states?.totalItems ?? 0);
  }

  private async writeStatus(
    pb: PocketBase,
    sync: DynatraceProblemSyncRecord | undefined,
    patch: Partial<DynatraceProblemSyncRecord>,
  ): Promise<void> {
    if (!sync) return;
    const changed = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) =>
          key !== 'nocSyncedAt' &&
          JSON.stringify(value) !== JSON.stringify(sync[key as keyof DynatraceProblemSyncRecord]),
      ),
    );
    // A clean cycle only refreshes nocSyncedAt when something else changed, to spare realtime.
    if (!Object.keys(changed).length) return;
    if (changed.nocSyncError) {
      loggers.main.warn('Dynatrace NOC note sync incomplete', { error: changed.nocSyncError });
    }
    await pb
      .collection(DYNATRACE_PROBLEM_SYNC_COLLECTION)
      .update(
        sync.id,
        { ...changed, ...(patch.nocSyncedAt ? { nocSyncedAt: patch.nocSyncedAt } : {}) },
        { requestKey: null },
      );
  }

  private async problemsById(
    pb: PocketBase,
    problemIds: string[],
  ): Promise<Map<string, ProblemKeys>> {
    const problems = await this.findProblems(pb, problemIds, 'problemId');
    return new Map(problems.map((problem) => [problem.problemId, problem]));
  }

  private async problemsByDisplayId(
    pb: PocketBase,
    displayIds: string[],
  ): Promise<Map<string, ProblemKeys>> {
    const problems = await this.findProblems(pb, displayIds, 'displayId');
    return new Map(problems.map((problem) => [problem.displayId, problem]));
  }

  private async findProblems(
    pb: PocketBase,
    values: string[],
    field: 'problemId' | 'displayId',
  ): Promise<ProblemKeys[]> {
    const unique = [...new Set(values)];
    const found: ProblemKeys[] = [];
    for (let index = 0; index < unique.length; index += 40) {
      const filter = unique
        .slice(index, index + 40)
        .map((value, position) =>
          pb.filter(`${field} = {:v${position}}`, { [`v${position}`]: value }),
        )
        .join(' || ');
      found.push(
        ...(await pb.collection(DYNATRACE_PROBLEMS_COLLECTION).getFullList<ProblemKeys>({
          filter,
          fields: 'problemId,displayId',
          requestKey: null,
        })),
      );
    }
    return found;
  }
}

/** Newest record wins by Grail time; a newer local ack still in the outbox is never replaced. */
function acceptsIncomingAck(
  existing: DynatraceProblemStateRecord,
  record: IncomingRecord,
): boolean {
  if (existing.ackId === record.recordId) {
    const storedTs = parseNocTimestamp(existing.grailTs);
    return storedTs === null || storedTs < record.timestamp || existing.sync !== 'synced';
  }
  if (existing.sync === 'pending') return false;
  const localTs = parseNocTimestamp(existing.grailTs || existing.updated);
  return localTs === null || localTs < record.timestamp;
}

function analystFields(row: { analyst?: string; enteredBy?: string }, name: string | undefined) {
  return {
    analyst: (row.analyst ?? '').toLowerCase(),
    analyst_name: name ?? '',
    entered_by: row.enteredBy ?? '',
    source: DYNATRACE_NOC_SOURCE,
  };
}

/** One `noc.note` per note ID, naming every problem its rows cover. No `timestamp`: Grail stamps it. */
function noteEvents(
  notes: DynatraceProblemNoteRecord[],
  problems: Map<string, ProblemKeys>,
): NocEvent[] {
  const byNoteId = new Map<string, DynatraceProblemNoteRecord[]>();
  for (const note of notes) {
    const key = note.noteId || note.id;
    byNoteId.set(key, [...(byNoteId.get(key) ?? []), note]);
  }
  return [...byNoteId].map(([noteId, rows]) => {
    // Rows arrive oldest first; the newest pending row holds the current text and state.
    const latest = rows.at(-1)!;
    const displayIds = [...new Set(rows.map((row) => problems.get(row.problemId)!.displayId))];
    return {
      'event.type': DYNATRACE_NOC_NOTE_EVENT_TYPE,
      'event.provider': DYNATRACE_NOC_EVENT_PROVIDER,
      note_id: noteId,
      display_id: displayIds[0]!,
      display_ids: displayIds,
      ...analystFields(latest, latest.author),
      text: latest.note.trim().slice(0, MAX_DYNATRACE_NOC_NOTE_LENGTH),
      state: latest.state === 'deleted' ? 'deleted' : 'active',
    };
  });
}

function ackEvent(state: DynatraceProblemStateRecord, problem: ProblemKeys): NocEvent {
  const addressed = state.addressed === true;
  return {
    'event.type': DYNATRACE_NOC_ACK_EVENT_TYPE,
    'event.provider': DYNATRACE_NOC_EVENT_PROVIDER,
    ack_id: state.ackId || state.id,
    display_id: problem.displayId,
    ...analystFields(state, state.addressedBy),
    state: addressed ? 'addressed' : 'cleared',
    ...(addressed && state.noteId ? { note_id: state.noteId } : {}),
    ...(addressed ? { scope_entities: state.scopeEntities ?? [] } : {}),
  };
}
