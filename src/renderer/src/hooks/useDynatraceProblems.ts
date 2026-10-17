import { useCallback, useMemo } from 'react';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  dynatraceAnalystKey,
  getDynatraceProblemResolvers,
  type DynatraceProblemNoteRecord,
  type DynatraceProblemRecord,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { useCollection } from './useCollection';
import {
  addDynatraceProblemNote,
  changeDynatraceProblemNote,
  setDynatraceProblemAddressed,
} from '../services/dynatraceProblemsService';

const HISTORY_PAGE_SIZE = 100;
const RELATED_PROBLEM_BATCH_SIZE = 40;

export function useDynatraceProblems() {
  const openProblems = useCollection<DynatraceProblemRecord>(DYNATRACE_PROBLEMS_COLLECTION, {
    sort: '-startTime,-id',
    filter: 'scopeExcluded=false && status="OPEN"',
  });
  const historyProblems = useCollection<DynatraceProblemRecord>(DYNATRACE_PROBLEMS_COLLECTION, {
    sort: '-startTime,-id',
    filter: 'scopeExcluded=false && status="CLOSED"',
    pageSize: HISTORY_PAGE_SIZE,
  });
  const problems = useMemo(
    () => [...openProblems.data, ...historyProblems.data],
    [historyProblems.data, openProblems.data],
  );
  const loadedProblemIds = useMemo(
    () => [...new Set(problems.map((problem) => problem.problemId))],
    [problems],
  );
  const states = useCollection<DynatraceProblemStateRecord>(DYNATRACE_PROBLEM_STATES_COLLECTION, {
    sort: '-updated',
    batchedFilter: {
      key: 'dynatrace-loaded-problems',
      field: 'problemId',
      values: loadedProblemIds,
      batchSize: RELATED_PROBLEM_BATCH_SIZE,
    },
    enabled: loadedProblemIds.length > 0,
  });
  const notes = useCollection<DynatraceProblemNoteRecord>(DYNATRACE_PROBLEM_NOTES_COLLECTION, {
    sort: 'created',
    batchedFilter: {
      key: 'dynatrace-loaded-problems',
      field: 'problemId',
      values: loadedProblemIds,
      batchSize: RELATED_PROBLEM_BATCH_SIZE,
    },
    enabled: loadedProblemIds.length > 0,
  });
  const sync = useCollection<DynatraceProblemSyncRecord>(DYNATRACE_PROBLEM_SYNC_COLLECTION, {
    sort: '-updated',
  });

  const syncRecord = sync.data[0] ?? null;
  const resolvers = useMemo(() => getDynatraceProblemResolvers(syncRecord), [syncRecord]);
  const analystByKey = useCallback(
    (key: string | undefined) =>
      key ? resolvers.find((analyst) => dynatraceAnalystKey(analyst) === key) : undefined,
    [resolvers],
  );

  const stateByProblemId = useMemo(
    () => new Map(states.data.map((state) => [state.problemId, state])),
    [states.data],
  );

  // Notes are append-only: an edit or delete is a newer row with the same note ID, so only the
  // newest row of each note on a problem is current.
  const currentNotes = useMemo(() => {
    const newest = new Map<string, DynatraceProblemNoteRecord>();
    for (const note of notes.data) {
      // A note saved before note IDs is keyed by its record ID, which its first edit adopts.
      const key = `${note.problemId}\u0000${note.noteId || note.id}`;
      const existing = newest.get(key);
      if (!existing || note.created > existing.created) newest.set(key, note);
    }
    return [...newest.values()];
  }, [notes.data]);

  const notesByProblemId = useMemo(() => {
    const grouped = new Map<string, DynatraceProblemNoteRecord[]>();
    for (const note of currentNotes) {
      if (note.state === 'deleted') continue;
      const problemNotes = grouped.get(note.problemId) ?? [];
      problemNotes.push(note);
      grouped.set(note.problemId, problemNotes);
    }
    // Imported notes are ordered by when Grail received them, not when Relay copied them.
    const noteTime = (note: DynatraceProblemNoteRecord) =>
      new Date(note.grailTs || note.created).getTime() || 0;
    for (const problemNotes of grouped.values()) {
      problemNotes.sort((a, b) => noteTime(a) - noteTime(b));
    }
    return grouped;
  }, [currentNotes]);

  const setAddressed = useCallback(
    async (problemId: string, addressed: boolean, responseNoteId?: string, resolver?: string) => {
      const problem = problems.find((candidate) => candidate.problemId === problemId);
      return setDynatraceProblemAddressed(
        problemId,
        addressed,
        stateByProblemId.get(problemId)?.id,
        responseNoteId,
        analystByKey(resolver),
        problem?.affectedEntities.map((entity) => entity.id) ?? [],
      );
    },
    [analystByKey, problems, stateByProblemId],
  );

  const addNote = useCallback(
    (problemId: string, note: string, resolver?: string) =>
      addDynatraceProblemNote(problemId, note, analystByKey(resolver)),
    [analystByKey],
  );

  /** Every row of the note: one note can cover several problems and they change together. */
  const noteRows = useCallback(
    (recordId: string) => {
      const note = currentNotes.find((candidate) => candidate.id === recordId);
      if (!note) return [];
      if (!note.noteId) return [note];
      return currentNotes.filter((candidate) => candidate.noteId === note.noteId);
    },
    [currentNotes],
  );

  const editNote = useCallback(
    (recordId: string, text: string) => changeDynatraceProblemNote(noteRows(recordId), { text }),
    [noteRows],
  );

  const deleteNote = useCallback(
    (recordId: string) => changeDynatraceProblemNote(noteRows(recordId), { deleted: true }),
    [noteRows],
  );

  const refetch = useCallback(async () => {
    await Promise.all([
      openProblems.refetch(),
      historyProblems.refetch(),
      states.refetch(),
      notes.refetch(),
      sync.refetch(),
    ]);
  }, [historyProblems, notes, openProblems, states, sync]);

  return {
    problems,
    stateByProblemId,
    notesByProblemId,
    sync: syncRecord,
    resolvers,
    totalHistoryCount: historyProblems.totalItems,
    hasMoreHistory: historyProblems.hasMore,
    loadingMoreHistory: historyProblems.loadingMore,
    historyCachedPartial: historyProblems.cachedPartial === true,
    loadMoreHistory: historyProblems.loadMore,
    loading:
      openProblems.loading ||
      historyProblems.loading ||
      states.loading ||
      notes.loading ||
      sync.loading,
    error: openProblems.error || historyProblems.error || states.error || notes.error || sync.error,
    setAddressed,
    addNote,
    editNote,
    deleteNote,
    refetch,
  };
}
