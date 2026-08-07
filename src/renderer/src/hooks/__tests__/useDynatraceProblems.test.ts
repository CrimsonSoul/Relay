import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
} from '@shared/dynatraceProblems';
import { useDynatraceProblems } from '../useDynatraceProblems';

const mocks = vi.hoisted(() => ({
  addNote: vi.fn(),
  setAddressed: vi.fn(),
  refetch: vi.fn(async () => undefined),
  collectionCalls: [] as Array<{ collection: string; options: Record<string, unknown> }>,
}));

const state = {
  id: 'state-1',
  problemId: 'problem-1',
  addressed: false,
  addressedBy: 'Historical Operator',
};
const historicalNote = {
  id: 'note-1',
  problemId: 'problem-1',
  note: 'A historical note without an operator ID.',
  author: 'Historical Operator',
  created: '2026-07-09T18:01:00.000Z',
};

vi.mock('../useCollection', () => ({
  useCollection: (collection: string, options: Record<string, unknown> = {}) => {
    mocks.collectionCalls.push({ collection, options });
    let data: object[] = [];
    if (collection === DYNATRACE_PROBLEM_STATES_COLLECTION) data = [state];
    if (collection === DYNATRACE_PROBLEM_NOTES_COLLECTION) data = [historicalNote];
    return {
      data,
      loading: false,
      error: null,
      totalItems: data.length,
      hasMore: false,
      loadingMore: false,
      cachedPartial: false,
      refetch: mocks.refetch,
      loadMore: vi.fn(async () => undefined),
    };
  },
}));

vi.mock('../../services/dynatraceProblemsService', () => ({
  addDynatraceProblemNote: mocks.addNote,
  setDynatraceProblemAddressed: mocks.setAddressed,
}));

describe('useDynatraceProblems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collectionCalls.length = 0;
  });

  it('passes ordinary writes without attribution and retains the existing state ID', async () => {
    const { result } = renderHook(() => useDynatraceProblems());

    await act(async () => {
      await result.current.addNote('problem-1', 'Investigating');
      await result.current.setAddressed('problem-1', true, 'new-response-note');
    });

    expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Investigating');
    expect(mocks.setAddressed).toHaveBeenCalledWith(
      'problem-1',
      true,
      'state-1',
      'new-response-note',
    );
  });

  it('preserves historical records that do not have an operator ID', () => {
    const { result } = renderHook(() => useDynatraceProblems());

    expect(result.current.stateByProblemId.get('problem-1')).toEqual(state);
    expect(result.current.notesByProblemId.get('problem-1')).toEqual([historicalNote]);
  });

  it('loads only in-scope open problems plus a bounded history page', () => {
    renderHook(() => useDynatraceProblems());

    const problemCalls = mocks.collectionCalls.filter(
      ({ collection }) => collection === DYNATRACE_PROBLEMS_COLLECTION,
    );
    expect(problemCalls).toEqual([
      {
        collection: DYNATRACE_PROBLEMS_COLLECTION,
        options: { sort: '-startTime,-id', filter: 'scopeExcluded=false && status="OPEN"' },
      },
      {
        collection: DYNATRACE_PROBLEMS_COLLECTION,
        options: {
          sort: '-startTime,-id',
          filter: 'scopeExcluded=false && status="CLOSED"',
          pageSize: 100,
        },
      },
    ]);

    const relatedCalls = mocks.collectionCalls.filter(
      ({ collection }) =>
        collection === DYNATRACE_PROBLEM_STATES_COLLECTION ||
        collection === DYNATRACE_PROBLEM_NOTES_COLLECTION,
    );
    expect(relatedCalls).toEqual([
      {
        collection: DYNATRACE_PROBLEM_STATES_COLLECTION,
        options: {
          sort: '-updated',
          batchedFilter: {
            key: 'dynatrace-loaded-problems',
            field: 'problemId',
            values: [],
            batchSize: 40,
          },
          enabled: false,
        },
      },
      {
        collection: DYNATRACE_PROBLEM_NOTES_COLLECTION,
        options: {
          sort: 'created',
          batchedFilter: {
            key: 'dynatrace-loaded-problems',
            field: 'problemId',
            values: [],
            batchSize: 40,
          },
          enabled: false,
        },
      },
    ]);
  });
});
