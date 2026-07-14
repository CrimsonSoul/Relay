import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import type { OperatorAttribution } from '@shared/operators';
import { escapeFilter, getConnectionState, getPb, handleApiError } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
import { mutateCollection } from './mutationGateway';

const MAX_NOTE_LENGTH = 5_000;

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

async function hasProblemNote(problemId: string): Promise<boolean> {
  try {
    await getPb()
      .collection(DYNATRACE_PROBLEM_NOTES_COLLECTION)
      .getFirstListItem(`problemId="${escapeFilter(problemId)}"`, { requestKey: null });
    return true;
  } catch (error) {
    if (isPbNotFoundError(error)) return false;
    throw error;
  }
}

async function requireProblemNoteWhenAddressing(
  problemId: string,
  addressed: boolean,
  online: boolean,
): Promise<void> {
  if (!addressed || !online) return;
  try {
    if (!(await hasProblemNote(problemId))) {
      throw new Error('Add a NOC note before marking this problem addressed locally.');
    }
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

export async function setDynatraceProblemAddressed(
  problemId: string,
  addressed: boolean,
  attribution: OperatorAttribution | null,
  existingRecordId?: string,
): Promise<DynatraceProblemStateRecord> {
  if (addressed && !attribution) {
    throw new Error('Choose an operator before marking this problem addressed locally.');
  }
  const online = getConnectionState() === 'online';
  await requireProblemNoteWhenAddressing(problemId, addressed, online);
  const payload = {
    problemId,
    addressed,
    addressedAt: addressed ? new Date().toISOString() : '',
    operatorId: addressed ? attribution!.operatorId : '',
    addressedBy: addressed ? attribution!.operatorName : '',
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
  attribution: OperatorAttribution,
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
        operatorId: attribution.operatorId,
        author: attribution.operatorName,
      },
    )) as DynatraceProblemNoteRecord;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}
