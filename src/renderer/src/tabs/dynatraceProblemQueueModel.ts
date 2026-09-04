import { getDynatraceProblemDisplayTitle } from '@shared/dynatraceProblems';
import type {
  DynatraceProblemNoteRecord,
  DynatraceProblemRecord,
  DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { parseDynatraceTicketReferenceNote } from '../services/dynatraceProblemsService';

export type ProblemFilter = 'unaddressed' | 'addressed' | 'resolved';
export type HistorySort = 'newest' | 'addressed-first' | 'response-first' | 'no-response-first';
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
  { id: 'addressed', label: 'Addressed locally' },
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

export function isProblemAddressed(state: DynatraceProblemStateRecord | undefined): boolean {
  return state?.addressed === true;
}

function matchesFilter(
  problem: DynatraceProblemRecord,
  state: DynatraceProblemStateRecord | undefined,
  filter: ProblemFilter,
): boolean {
  if (filter === 'resolved') return problem.status === 'CLOSED';
  if (problem.status !== 'OPEN') return false;
  return filter === 'addressed' ? isProblemAddressed(state) : !isProblemAddressed(state);
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

function summarizeProblemResponse(
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

  const addressed = isProblemAddressed(state);
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

  return aRank - bRank || problemSort(a, b);
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
}: DynatraceProblemQueueModelInput) {
  let unaddressed = 0;
  let addressed = 0;
  let loadedHistory = 0;
  const responseSummaries = new Map<string, ProblemResponseSummary>();

  for (const problem of problems) {
    if (problem.status === 'CLOSED') loadedHistory += 1;
    else if (isProblemAddressed(stateByProblemId.get(problem.problemId))) addressed += 1;
    else unaddressed += 1;
    responseSummaries.set(
      problem.problemId,
      summarizeProblemResponse(
        stateByProblemId.get(problem.problemId),
        notesByProblemId.get(problem.problemId) ?? [],
      ),
    );
  }

  const unaddressedProblemIds = problems
    .filter(
      (problem) =>
        problem.status !== 'CLOSED' && !isProblemAddressed(stateByProblemId.get(problem.problemId)),
    )
    .sort(problemSort)
    .map((problem) => problem.problemId);
  const normalizedQuery = query.trim().toLowerCase();
  const scopedProblems = problems
    .filter((problem) => matchesFilter(problem, stateByProblemId.get(problem.problemId), filter))
    .filter((problem) => !normalizedQuery || searchableText(problem).includes(normalizedQuery));
  const filteredProblems = scopedProblems
    .filter(
      (problem) =>
        filter !== 'resolved' ||
        matchesHistoryResponseFilter(
          responseSummaries.get(problem.problemId) ?? EMPTY_RESPONSE_SUMMARY,
          historyResponseFilter,
        ),
    )
    .sort((a, b) =>
      filter === 'resolved'
        ? historyProblemSort(a, b, historySort, responseSummaries)
        : problemSort(a, b),
    );

  return {
    counts: {
      unaddressed,
      addressed,
      resolved: Math.max(totalHistoryCount, loadedHistory),
      loadedHistory,
    },
    unaddressedProblemIds,
    responseSummaries,
    filteredProblems,
    historyScopeCount: filter === 'resolved' ? scopedProblems.length : 0,
  };
}
