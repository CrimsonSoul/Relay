import { useMemo } from 'react';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  type DynatraceProblemRecord,
  type DynatraceProblemStateRecord,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import { useCollection } from './useCollection';
import { isProblemAddressed } from '../tabs/dynatraceProblemQueueModel';

const STATE_BATCH_SIZE = 40;

/**
 * Whether the count reflects Dynatrace right now. `off` (sync disabled or never set up),
 * `failed` (the latest sync failed) and `stale` (a failed sync is still being retried) all mean
 * the count only reflects problems already stored in Relay.
 */
export type ProblemCountFreshness = 'live' | 'off' | 'failed' | 'stale';

export type UnaddressedProblemCount = {
  /** `null` until the problems, their states and the sync record have loaded. */
  count: number | null;
  freshness: ProblemCountFreshness;
};

export function problemCountFreshness(
  sync: DynatraceProblemSyncRecord | null,
): ProblemCountFreshness {
  if (!sync || sync.state === 'disabled') return 'off';
  if (sync.state === 'error') return 'failed';
  return sync.staleSince ? 'stale' : 'live';
}

/**
 * Open Dynatrace problems still waiting for a NOC response, for the
 * sidebar badge, plus whether Dynatrace sync is keeping that count current.
 * The open-problem and sync queries match `useDynatraceProblems`, so both share
 * one collection store each.
 */
export function useUnaddressedProblemCount(): UnaddressedProblemCount {
  const openProblems = useCollection<DynatraceProblemRecord>(DYNATRACE_PROBLEMS_COLLECTION, {
    sort: '-startTime,-id',
    filter: 'scopeExcluded=false && status="OPEN"',
  });
  const sync = useCollection<DynatraceProblemSyncRecord>(DYNATRACE_PROBLEM_SYNC_COLLECTION, {
    sort: '-updated',
  });
  const openProblemIds = useMemo(
    () => [...new Set(openProblems.data.map((problem) => problem.problemId))],
    [openProblems.data],
  );
  const states = useCollection<DynatraceProblemStateRecord>(DYNATRACE_PROBLEM_STATES_COLLECTION, {
    sort: '-updated',
    batchedFilter: {
      key: 'dynatrace-open-problems',
      field: 'problemId',
      values: openProblemIds,
      batchSize: STATE_BATCH_SIZE,
    },
    enabled: openProblemIds.length > 0,
  });
  const syncRecord = sync.data[0] ?? null;

  const count = useMemo(() => {
    if (!openProblems.hasLoadedSnapshot || !sync.hasLoadedSnapshot) return null;
    if (openProblemIds.length > 0 && !states.hasLoadedSnapshot) return null;
    const addressedIds = new Set(
      states.data.filter((state) => isProblemAddressed(state)).map((state) => state.problemId),
    );
    return openProblemIds.filter((problemId) => !addressedIds.has(problemId)).length;
  }, [
    openProblemIds,
    openProblems.hasLoadedSnapshot,
    states.data,
    states.hasLoadedSnapshot,
    sync.hasLoadedSnapshot,
  ]);

  return { count, freshness: problemCountFreshness(syncRecord) };
}
