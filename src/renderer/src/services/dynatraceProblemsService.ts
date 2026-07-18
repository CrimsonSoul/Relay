import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { escapeFilter, getConnectionState, getPb, handleApiError } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import { mutateCollection } from './mutationGateway';

const MAX_NOTE_LENGTH = 5_000;
export const MAX_DYNATRACE_TICKET_REFERENCE_LENGTH = 120;
export const DYNATRACE_TICKET_NOTE_PREFIX = 'Ticket: ';
const REQUIRED_RESPONSE_MESSAGE =
  'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.';

function normalizeDynatraceTicketReference(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('Enter a Service Desk ticket number.');
  if (/[\r\n]/.test(normalized)) throw new Error('Ticket numbers must fit on one line.');
  if (normalized.length > MAX_DYNATRACE_TICKET_REFERENCE_LENGTH) {
    throw new Error(
      `Ticket numbers can be up to ${MAX_DYNATRACE_TICKET_REFERENCE_LENGTH.toLocaleString()} characters.`,
    );
  }
  return normalized;
}

export function formatDynatraceTicketReferenceNote(value: string): string {
  return `${DYNATRACE_TICKET_NOTE_PREFIX}${normalizeDynatraceTicketReference(value)}`;
}

export function parseDynatraceTicketReferenceNote(note: string): string | null {
  if (!note.startsWith(DYNATRACE_TICKET_NOTE_PREFIX)) return null;
  try {
    return normalizeDynatraceTicketReference(note.slice(DYNATRACE_TICKET_NOTE_PREFIX.length));
  } catch {
    return null;
  }
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

async function requireProblemResponseWhenAddressing(
  problemId: string,
  addressed: boolean,
  online: boolean,
  responseNoteId?: string,
): Promise<void> {
  if (!addressed) return;
  const normalizedResponseNoteId = responseNoteId?.trim();
  if (!normalizedResponseNoteId) throw new Error(REQUIRED_RESPONSE_MESSAGE);
  if (!online) return;

  try {
    const responseNote = await getPb()
      .collection(DYNATRACE_PROBLEM_NOTES_COLLECTION)
      .getOne<Pick<DynatraceProblemNoteRecord, 'problemId'>>(normalizedResponseNoteId, {
        requestKey: null,
      });
    if (responseNote.problemId !== problemId) throw new Error(REQUIRED_RESPONSE_MESSAGE);
  } catch (error) {
    if (isPbNotFoundError(error)) throw new Error(REQUIRED_RESPONSE_MESSAGE);
    handleApiError(error);
    throw error;
  }
}

export async function setDynatraceProblemAddressed(
  problemId: string,
  addressed: boolean,
  existingRecordId?: string,
  responseNoteId?: string,
): Promise<DynatraceProblemStateRecord> {
  const online = getConnectionState() === 'online';
  await requireProblemResponseWhenAddressing(problemId, addressed, online, responseNoteId);
  const payload = {
    problemId,
    addressed,
    addressedAt: addressed ? new Date().toISOString() : '',
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
): Promise<DynatraceProblemNoteRecord> {
  const normalizedNote = note.trim();
  if (!normalizedNote) throw new Error('Enter a note before saving.');
  if (normalizedNote.length > MAX_NOTE_LENGTH) {
    throw new Error(`Notes can be up to ${MAX_NOTE_LENGTH.toLocaleString()} characters.`);
  }

  try {
    return (await mutateCollection<DynatraceProblemNoteRecord>(
      DYNATRACE_PROBLEM_NOTES_COLLECTION,
      'create',
      undefined,
      {
        problemId,
        note: normalizedNote,
      },
    )) as DynatraceProblemNoteRecord;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}
