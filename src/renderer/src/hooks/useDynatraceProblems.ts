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
    async (problemId: string, addressed: boolean, responseNoteId?: string, resolver?: string) =>
      resolver
        ? setDynatraceProblemAddressed(
            problemId,
            addressed,
            stateByProblemId.get(problemId)?.id,
            responseNoteId,
            resolver,
          )
        : setDynatraceProblemAddressed(
            problemId,
            addressed,
            stateByProblemId.get(problemId)?.id,
            responseNoteId,
          ),
    [stateByProblemId],
  );

  const addNote = useCallback(
    (problemId: string, note: string, author?: string) =>
      author
        ? addDynatraceProblemNote(problemId, note, author)
        : addDynatraceProblemNote(problemId, note),
    [],
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
    sync: sync.data[0] ?? null,
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
    refetch,
  };
}
