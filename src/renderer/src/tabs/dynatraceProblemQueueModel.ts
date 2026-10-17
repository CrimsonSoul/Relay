import { getDynatraceProblemDisplayTitle, isDynatraceAckInForce } from '@shared/dynatraceProblems';
import type {
  DynatraceProblemNoteRecord,
  DynatraceProblemRecord,
  DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { parseDynatraceTicketReferenceNote } from '../services/dynatraceProblemsService';

export type ProblemFilter = 'unaddressed' | 'addressed' | 'resolved';
export type HistorySort = 'newest' | 'addressed-first' | 'response-first' | 'no-response-first';
/** Order of the open queues (Unaddressed, Addressed). */
export type QueueSort = 'newest' | 'oldest';
export type HistoryResponseFilter =
  'all' | 'local-response' | 'addressed' | 'notes' | 'tickets' | 'none';

export type ProblemResponseSummary = {
  addressed: boolean;
  hasLocalResponse: boolean;
  nocNoteCount: number;
  responder: string;
  ticketReferences: string[];
};

export type HistoryPreferences = {
  sort: HistorySort;
  responseFilter: HistoryResponseFilter;
};

export const PROBLEM_FILTERS: Array<{ id: ProblemFilter; label: string }> = [
  { id: 'unaddressed', label: 'Unaddressed' },
  { id: 'addressed', label: 'Addressed' },
  { id: 'resolved', label: 'History' },
];

const HISTORY_PREFERENCES_STORAGE_KEY = 'relay-dynatrace-history-preferences';
const DEFAULT_HISTORY_PREFERENCES: HistoryPreferences = {
  sort: 'newest',
  responseFilter: 'all',
};
const EMPTY_RESPONSE_SUMMARY: ProblemResponseSummary = {
  addressed: false,
  hasLocalResponse: false,
  nocNoteCount: 0,
  responder: '',
  ticketReferences: [],
};
const HISTORY_SORTS = new Set<HistorySort>([
  'newest',
  'addressed-first',
  'response-first',
  'no-response-first',
]);
const HISTORY_RESPONSE_FILTERS = new Set<HistoryResponseFilter>([
  'all',
  'local-response',
  'addressed',
  'notes',
  'tickets',
  'none',
]);

const QUEUE_SORT_STORAGE_KEY = 'relay-dynatrace-queue-sort';

/** Per-workstation queue order; newest first unless the operator chose oldest first. */
export function readQueueSort(): QueueSort {
  try {
    return globalThis.localStorage?.getItem(QUEUE_SORT_STORAGE_KEY) === 'oldest'
      ? 'oldest'
      : 'newest';
  } catch {
    return 'newest';
  }
}

export function writeQueueSort(sort: QueueSort): void {
  try {
    globalThis.localStorage?.setItem(QUEUE_SORT_STORAGE_KEY, sort);
  } catch {
    // Best-effort convenience; the queue still sorts for this session.
  }
}

export function readHistoryPreferences(): HistoryPreferences {
  try {
    const stored = globalThis.localStorage?.getItem(HISTORY_PREFERENCES_STORAGE_KEY);
    if (!stored) return DEFAULT_HISTORY_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<HistoryPreferences>;
    return {
      sort:
        typeof parsed.sort === 'string' && HISTORY_SORTS.has(parsed.sort as HistorySort)
          ? (parsed.sort as HistorySort)
          : DEFAULT_HISTORY_PREFERENCES.sort,
      responseFilter:
        typeof parsed.responseFilter === 'string' &&
        HISTORY_RESPONSE_FILTERS.has(parsed.responseFilter as HistoryResponseFilter)
          ? (parsed.responseFilter as HistoryResponseFilter)
          : DEFAULT_HISTORY_PREFERENCES.responseFilter,
    };
  } catch {
    return DEFAULT_HISTORY_PREFERENCES;
  }
}

export function writeHistoryPreferences(preferences: HistoryPreferences): void {
  try {
    globalThis.localStorage?.setItem(HISTORY_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preference persistence is best-effort; History remains fully usable without it.
  }
}

/** Pass the problem to apply Infra Health's lapse rule: an entity outside the ack's scope. */
export function isProblemAddressed(
  state: DynatraceProblemStateRecord | undefined,
  problem?: Pick<DynatraceProblemRecord, 'affectedEntities'>,
): boolean {
  return isDynatraceAckInForce(state, problem);
}

function matchesFilter(
  problem: DynatraceProblemRecord,
  state: DynatraceProblemStateRecord | undefined,
  filter: ProblemFilter,
): boolean {
  if (filter === 'resolved') return problem.status === 'CLOSED';
  if (problem.status !== 'OPEN') return false;
  return filter === 'addressed'
    ? isProblemAddressed(state, problem)
    : !isProblemAddressed(state, problem);
}

function searchableText(problem: DynatraceProblemRecord): string {
  return [
    problem.title,
    getDynatraceProblemDisplayTitle(problem),
    problem.workflowDescription ?? '',
    ...(problem.workflowTags ?? []),
    ...(problem.workflowAffectedEntityTypes ?? []),
    problem.displayId,
    problem.problemId,
    problem.rootCauseName,
    ...problem.affectedEntities.flatMap((entity) => [entity.name, entity.id, entity.type]),
    ...problem.impactedEntities.flatMap((entity) => [entity.name, entity.id, entity.type]),
    ...(problem.alertingProfiles ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function problemSort(a: DynatraceProblemRecord, b: DynatraceProblemRecord): number {
  return b.startTime - a.startTime || b.id.localeCompare(a.id);
}

/** History rows show when Dynatrace resolved each problem, so newest first follows that time. */
function resolvedSort(a: DynatraceProblemRecord, b: DynatraceProblemRecord): number {
  const resolvedAt = (problem: DynatraceProblemRecord) =>
    problem.endTime > 0 ? problem.endTime : problem.startTime;
  return resolvedAt(b) - resolvedAt(a) || problemSort(a, b);
}

function summarizeProblemResponse(
  problem: DynatraceProblemRecord,
  state: DynatraceProblemStateRecord | undefined,
  notes: readonly DynatraceProblemNoteRecord[],
): ProblemResponseSummary {
  const ticketReferenceTimes = new Map<string, number>();
  let nocNoteCount = 0;
  let latestAttributedNote: DynatraceProblemNoteRecord | undefined;

  for (const note of notes) {
    const ticketReference = parseDynatraceTicketReferenceNote(note.note);
    if (ticketReference) {
      const createdAt = new Date(note.created).getTime();
      const timestamp = Number.isFinite(createdAt) ? createdAt : 0;
      const previousTimestamp = ticketReferenceTimes.get(ticketReference);
      if (previousTimestamp === undefined || timestamp >= previousTimestamp) {
        ticketReferenceTimes.set(ticketReference, timestamp);
      }
    } else {
      nocNoteCount += 1;
    }
    if (
      note.author?.trim() &&
      (!latestAttributedNote ||
        new Date(note.created).getTime() >= new Date(latestAttributedNote.created).getTime())
    ) {
      latestAttributedNote = note;
    }
  }

  const addressed = isProblemAddressed(state, problem);
  return {
    addressed,
    hasLocalResponse: addressed || notes.length > 0,
    nocNoteCount,
    responder: state?.addressedBy?.trim() || latestAttributedNote?.author?.trim() || '',
    ticketReferences: [...ticketReferenceTimes]
      .sort(([, aTimestamp], [, bTimestamp]) => bTimestamp - aTimestamp)
      .map(([reference]) => reference),
  };
}

function matchesHistoryResponseFilter(
  summary: ProblemResponseSummary,
  responseFilter: HistoryResponseFilter,
): boolean {
  switch (responseFilter) {
    case 'local-response':
      return summary.hasLocalResponse;
    case 'addressed':
      return summary.addressed;
    case 'notes':
      return summary.nocNoteCount > 0;
    case 'tickets':
      return summary.ticketReferences.length > 0;
    case 'none':
      return !summary.hasLocalResponse;
    default:
      return true;
  }
}

function historyProblemSort(
  a: DynatraceProblemRecord,
  b: DynatraceProblemRecord,
  sort: HistorySort,
  responseSummaries: Map<string, ProblemResponseSummary>,
): number {
  const aSummary = responseSummaries.get(a.problemId);
  const bSummary = responseSummaries.get(b.problemId);
  let aRank = 0;
  let bRank = 0;

  if (sort === 'addressed-first') {
    aRank = aSummary?.addressed ? 0 : 1;
    bRank = bSummary?.addressed ? 0 : 1;
  } else if (sort === 'response-first') {
    aRank = aSummary?.hasLocalResponse ? 0 : 1;
    bRank = bSummary?.hasLocalResponse ? 0 : 1;
  } else if (sort === 'no-response-first') {
    aRank = aSummary?.hasLocalResponse ? 1 : 0;
    bRank = bSummary?.hasLocalResponse ? 1 : 0;
  }

  return aRank - bRank || resolvedSort(a, b);
}

type DynatraceProblemQueueModelInput = {
  problems: readonly DynatraceProblemRecord[];
  stateByProblemId: ReadonlyMap<string, DynatraceProblemStateRecord>;
  notesByProblemId: ReadonlyMap<string, readonly DynatraceProblemNoteRecord[]>;
  totalHistoryCount: number;
  filter: ProblemFilter;
  query: string;
  historySort: HistorySort;
  historyResponseFilter: HistoryResponseFilter;
  queueSort?: QueueSort;
};

export function buildDynatraceProblemQueueModel({
  problems,
  stateByProblemId,
  notesByProblemId,
  totalHistoryCount,
  filter,
  query,
  historySort,
  historyResponseFilter,
  queueSort = 'newest',
}: DynatraceProblemQueueModelInput) {
  let unaddressed = 0;
  let addressed = 0;
  let loadedHistory = 0;
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (problem: DynatraceProblemRecord) =>
    !normalizedQuery || searchableText(problem).includes(normalizedQuery);
  // Filter tab badges follow the search so operators can see which tab holds their matches.
  const filterCounts: Record<ProblemFilter, number> = { unaddressed: 0, addressed: 0, resolved: 0 };
  const responseSummaries = new Map<string, ProblemResponseSummary>();

  for (const problem of problems) {
    const state = stateByProblemId.get(problem.problemId);
    let bucket: ProblemFilter = 'unaddressed';
    if (problem.status === 'CLOSED') bucket = 'resolved';
    else if (isProblemAddressed(state, problem)) bucket = 'addressed';
    if (bucket === 'resolved') loadedHistory += 1;
    else if (bucket === 'addressed') addressed += 1;
    else unaddressed += 1;
    if (normalizedQuery && matchesQuery(problem)) filterCounts[bucket] += 1;
    responseSummaries.set(
      problem.problemId,
      summarizeProblemResponse(problem, state, notesByProblemId.get(problem.problemId) ?? []),
    );
  }
  const resolved = Math.max(totalHistoryCount, loadedHistory);
  if (!normalizedQuery) {
    filterCounts.unaddressed = unaddressed;
    filterCounts.addressed = addressed;
    filterCounts.resolved = resolved;
  }

  const scopedProblems = problems
    .filter((problem) => matchesFilter(problem, stateByProblemId.get(problem.problemId), filter))
    .filter(matchesQuery);
  const filteredProblems = scopedProblems
    .filter(
      (problem) =>
        filter !== 'resolved' ||
        matchesHistoryResponseFilter(
          responseSummaries.get(problem.problemId) ?? EMPTY_RESPONSE_SUMMARY,
          historyResponseFilter,
        ),
    )
    .sort((a, b) => {
      if (filter === 'resolved') return historyProblemSort(a, b, historySort, responseSummaries);
      // Oldest first surfaces the long-running problems a newest-first queue pushes below the fold.
      return queueSort === 'oldest' ? -problemSort(a, b) : problemSort(a, b);
    });

  return {
    counts: {
      unaddressed,
      addressed,
      resolved,
      loadedHistory,
    },
    filterCounts,
    responseSummaries,
    filteredProblems,
    historyScopeCount: filter === 'resolved' ? scopedProblems.length : 0,
  };
}
