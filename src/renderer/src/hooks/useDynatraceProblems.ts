import { useCallback, useMemo } from 'react';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemRecord,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { useCollection } from './useCollection';
import {
  addDynatraceProblemNote,
  setDynatraceProblemAddressed,
} from '../services/dynatraceProblemsService';

export function useDynatraceProblems() {
  const problems = useCollection<DynatraceProblemRecord>(DYNATRACE_PROBLEMS_COLLECTION, {
    sort: '-startTime',
  });
  const states = useCollection<DynatraceProblemStateRecord>(DYNATRACE_PROBLEM_STATES_COLLECTION, {
    sort: '-updated',
  });
  const notes = useCollection<DynatraceProblemNoteRecord>(DYNATRACE_PROBLEM_NOTES_COLLECTION, {
    sort: 'created',
  });
  const sync = useCollection<DynatraceProblemSyncRecord>(DYNATRACE_PROBLEM_SYNC_COLLECTION, {
    sort: '-updated',
  });

  const stateByProblemId = useMemo(
    () => new Map(states.data.map((state) => [state.problemId, state])),
    [states.data],
  );

  const notesByProblemId = useMemo(() => {
    const grouped = new Map<string, DynatraceProblemNoteRecord[]>();
    for (const note of notes.data) {
      const problemNotes = grouped.get(note.problemId) ?? [];
      problemNotes.push(note);
      grouped.set(note.problemId, problemNotes);
    }
    return grouped;
  }, [notes.data]);

  const setAddressed = useCallback(
    async (problemId: string, addressed: boolean, responseNoteId?: string) =>
      setDynatraceProblemAddressed(
        problemId,
        addressed,
        stateByProblemId.get(problemId)?.id,
        responseNoteId,
      ),
    [stateByProblemId],
  );

  const addNote = useCallback(
    (problemId: string, note: string) => addDynatraceProblemNote(problemId, note),
    [],
  );

  const refetch = useCallback(async () => {
    await Promise.all([problems.refetch(), states.refetch(), notes.refetch(), sync.refetch()]);
  }, [notes, problems, states, sync]);

  return {
    problems: problems.data,
    stateByProblemId,
    notesByProblemId,
    sync: sync.data[0] ?? null,
    loading: problems.loading || states.loading || notes.loading || sync.loading,
    error: problems.error || states.error || notes.error || sync.error,
    setAddressed,
    addNote,
    refetch,
  };
}
