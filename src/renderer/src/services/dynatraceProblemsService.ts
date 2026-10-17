import {
  buildRelayEnteredBy,
  createNocRecordId,
  DYNATRACE_NOC_SOURCE,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  isDynatraceProblemResolver,
  MAX_DYNATRACE_NOC_NOTE_LENGTH,
  type DynatraceNocAnalyst,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { escapeFilter, getConnectionState, getPb, handleApiError } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import { mutateCollection } from './mutationGateway';

export const MAX_DYNATRACE_TICKET_REFERENCE_LENGTH = 120;
export const DYNATRACE_TICKET_NOTE_PREFIX = 'Ticket: ';
const REQUIRED_RESPONSE_MESSAGE = 'Add a NOC note before marking this problem addressed.';
const REQUIRED_RESOLVER_MESSAGE = 'Select your name from the resolver list.';

let workstationIdentity: Promise<string> | null = null;
/** note_id of notes saved in this session, so an offline ack can still name its note. */
const noteIdByRecordId = new Map<string, string>();

/** Stamped on notes and acks so Dynatrace can tell which Relay workstation wrote them. */
function getWorkstationIdentity(): Promise<string> {
  workstationIdentity ??= Promise.resolve(globalThis.api?.getWorkstationIdentity?.())
    .then((identity) => (typeof identity === 'string' && identity ? identity : ''))
    .catch(() => '')
    .then((identity) => identity || buildRelayEnteredBy('', ''));
  return workstationIdentity;
}

function normalizeAnalyst(value: DynatraceNocAnalyst | undefined): DynatraceNocAnalyst | undefined {
  if (!value) return undefined;
  const analyst = { email: value.email.trim().toLowerCase(), name: value.name.trim() };
  if (!isDynatraceProblemResolver(analyst.name) || (analyst.email && !analyst.email.includes('@')))
    throw new Error(REQUIRED_RESOLVER_MESSAGE);
  return analyst;
}

export function parseDynatraceTicketReferenceNote(note: string): string | null {
  if (!note.startsWith(DYNATRACE_TICKET_NOTE_PREFIX)) return null;
  const reference = note.slice(DYNATRACE_TICKET_NOTE_PREFIX.length).trim();
  return reference &&
    !/[\r\n]/.test(reference) &&
    reference.length <= MAX_DYNATRACE_TICKET_REFERENCE_LENGTH
    ? reference
    : null;
}

async function findState(problemId: string): Promise<DynatraceProblemStateRecord | null> {
  try {
    return await getPb()
      .collection(DYNATRACE_PROBLEM_STATES_COLLECTION)
      .getFirstListItem<DynatraceProblemStateRecord>(`problemId="${escapeFilter(problemId)}"`, {
        requestKey: null,
      });
  } catch (error) {
    if (isPbNotFoundError(error)) return null;
    throw error;
  }
}

/** Checks the response note and returns its note_id for the ack. */
async function requireProblemResponseWhenAddressing(
  problemId: string,
  addressed: boolean,
  online: boolean,
  responseNoteId?: string,
  analyst?: DynatraceNocAnalyst,
): Promise<string> {
  if (!addressed) return '';
  if (!analyst) throw new Error(REQUIRED_RESOLVER_MESSAGE);
  const normalizedResponseNoteId = responseNoteId?.trim();
  if (!normalizedResponseNoteId) throw new Error(REQUIRED_RESPONSE_MESSAGE);
  const knownNoteId = noteIdByRecordId.get(normalizedResponseNoteId) ?? '';
  if (!online) return knownNoteId;

  try {
    const responseNote = await getPb()
      .collection(DYNATRACE_PROBLEM_NOTES_COLLECTION)
      .getOne<Pick<DynatraceProblemNoteRecord, 'problemId' | 'author' | 'noteId'>>(
        normalizedResponseNoteId,
        { requestKey: null },
      );
    if (responseNote.problemId !== problemId || responseNote.author !== analyst.name) {
      throw new Error(REQUIRED_RESPONSE_MESSAGE);
    }
    return responseNote.noteId || knownNoteId;
  } catch (error) {
    if (isPbNotFoundError(error)) throw new Error(REQUIRED_RESPONSE_MESSAGE);
    handleApiError(error);
    throw error;
  }
}

/**
 * Records a new `noc.ack` (addressed or cleared) as the problem's latest ack. The row is saved as
 * `sync: pending`; the Relay server sends it to Dynatrace, where Infra Health sees it.
 */
export async function setDynatraceProblemAddressed(
  problemId: string,
  addressed: boolean,
  existingRecordId?: string,
  responseNoteId?: string,
  analystInput?: DynatraceNocAnalyst,
  scopeEntities: string[] = [],
): Promise<DynatraceProblemStateRecord> {
  const online = getConnectionState() === 'online';
  const analyst = normalizeAnalyst(analystInput);
  const noteId = await requireProblemResponseWhenAddressing(
    problemId,
    addressed,
    online,
    responseNoteId,
    analyst,
  );
  const payload = {
    problemId,
    addressed,
    addressedAt: addressed ? new Date().toISOString() : '',
    addressedBy: addressed ? (analyst?.name ?? '') : '',
    ackId: createNocRecordId(),
    ackState: addressed ? 'addressed' : 'cleared',
    analyst: addressed ? (analyst?.email ?? '') : '',
    enteredBy: await getWorkstationIdentity(),
    source: DYNATRACE_NOC_SOURCE,
    noteId,
    scopeEntities: addressed ? scopeEntities : [],
    sync: 'pending',
    syncError: '',
  };
  try {
    const recordId = existingRecordId || (online ? (await findState(problemId))?.id : undefined);
    return (await mutateCollection<DynatraceProblemStateRecord>(
      DYNATRACE_PROBLEM_STATES_COLLECTION,
      recordId ? 'update' : 'create',
      recordId,
      payload,
    )) as DynatraceProblemStateRecord;
  } catch (error) {
    // A second workstation may have created the unique state row between lookup and create.
    const existing = online ? await findState(problemId).catch(() => null) : null;
    if (existing && !existingRecordId) {
      return (await mutateCollection<DynatraceProblemStateRecord>(
        DYNATRACE_PROBLEM_STATES_COLLECTION,
        'update',
        existing.id,
        payload,
      )) as DynatraceProblemStateRecord;
    }
    handleApiError(error);
    throw error;
  }
}

export async function addDynatraceProblemNote(
  problemId: string,
  note: string,
  analystInput?: DynatraceNocAnalyst,
): Promise<DynatraceProblemNoteRecord> {
  const normalizedNote = note.trim();
  const analyst = normalizeAnalyst(analystInput);
  if (!normalizedNote) throw new Error('Enter a note before saving.');
  if (normalizedNote.length > MAX_DYNATRACE_NOC_NOTE_LENGTH) {
    throw new Error(
      `Notes can be up to ${MAX_DYNATRACE_NOC_NOTE_LENGTH.toLocaleString()} characters.`,
    );
  }

  const noteId = createNocRecordId();
  try {
    const record = (await mutateCollection<DynatraceProblemNoteRecord>(
      DYNATRACE_PROBLEM_NOTES_COLLECTION,
      'create',
      undefined,
      {
        problemId,
        note: normalizedNote,
        ...(analyst ? { author: analyst.name, analyst: analyst.email } : {}),
        noteId,
        enteredBy: await getWorkstationIdentity(),
        source: DYNATRACE_NOC_SOURCE,
        state: 'active',
        sync: 'pending',
      },
    )) as DynatraceProblemNoteRecord;
    if (record?.id) noteIdByRecordId.set(record.id, noteId);
    return record;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

/**
 * Edits or deletes a note everywhere it appears. Notes are append-only, so the change is a new
 * row per problem under the same note ID; the newest row is the one Relay shows. The outbox then
 * sends one `noc.note` with that note ID, which replaces the earlier version in Dynatrace and
 * Infra Health.
 */
function editedNoteText(change: { text: string } | { deleted: true }): string | undefined {
  if (!('text' in change)) return undefined;
  const text = change.text.trim();
  if (!text) throw new Error('Enter a note before saving. To remove it, delete the note.');
  if (text.length > MAX_DYNATRACE_NOC_NOTE_LENGTH) {
    throw new Error(
      `Notes can be up to ${MAX_DYNATRACE_NOC_NOTE_LENGTH.toLocaleString()} characters.`,
    );
  }
  return text;
}

/** Carries the note's author, problems and replaced Grail version onto the newer row. */
function carriedNoteFields(row: DynatraceProblemNoteRecord): Record<string, unknown> {
  return {
    ...(row.author ? { author: row.author } : {}),
    ...(row.analyst ? { analyst: row.analyst } : {}),
    ...(row.displayIds ? { displayIds: row.displayIds } : {}),
    // The version this change replaces, so an earlier Grail copy cannot overwrite it.
    ...(row.grailTs ? { grailTs: row.grailTs } : {}),
  };
}

export async function changeDynatraceProblemNote(
  rows: readonly DynatraceProblemNoteRecord[],
  change: { text: string } | { deleted: true },
): Promise<void> {
  if (rows.length === 0) throw new Error('This note is no longer in Relay.');
  const text = editedNoteText(change);
  const enteredBy = await getWorkstationIdentity();
  try {
    for (const row of rows) {
      await mutateCollection(DYNATRACE_PROBLEM_NOTES_COLLECTION, 'create', undefined, {
        problemId: row.problemId,
        note: text ?? row.note,
        state: text === undefined ? 'deleted' : 'active',
        // Older local notes predate note IDs; give them one so the change has a stable key.
        noteId: row.noteId || rows[0]!.noteId || row.id,
        ...carriedNoteFields(row),
        enteredBy,
        source: DYNATRACE_NOC_SOURCE,
        sync: 'pending',
      });
    }
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}
