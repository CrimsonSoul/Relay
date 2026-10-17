import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
} from '@shared/dynatraceProblems';
import { useDynatraceProblems } from '../useDynatraceProblems';

const mocks = vi.hoisted(() => ({
  addNote: vi.fn(),
  setAddressed: vi.fn(),
  refetch: vi.fn(async () => undefined),
  collectionCalls: [] as Array<{ collection: string; options: Record<string, unknown> }>,
  openProblems: [] as object[],
  extraNotes: [] as object[],
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
const deletedNote = {
  id: 'note-2',
  problemId: 'problem-1',
  note: 'Removed in Infra Health',
  state: 'deleted',
  created: '2026-07-09T18:02:00.000Z',
};
const editedNoteOriginal = {
  id: 'note-3',
  problemId: 'problem-1',
  noteId: 'shared-note',
  note: 'Vendor dispatched',
  created: '2026-07-09T18:03:00.000Z',
};
const editedNoteLatest = {
  ...editedNoteOriginal,
  id: 'note-4',
  note: 'Vendor on site',
  created: '2026-07-09T18:04:00.000Z',
};
const openProblem = {
  id: 'p-1',
  problemId: 'problem-1',
  displayId: 'P-1',
  affectedEntities: [{ id: 'HOST-1', type: 'HOST', name: 'host' }],
};
const syncRecord = {
  id: 'sync-1',
  key: 'primary',
  nocAnalysts: [{ email: 'paris@example.com', name: 'Paris' }],
};

vi.mock('../useCollection', () => ({
  useCollection: (collection: string, options: Record<string, unknown> = {}) => {
    mocks.collectionCalls.push({ collection, options });
    let data: object[] = [];
    if (collection === DYNATRACE_PROBLEM_STATES_COLLECTION) data = [state];
    if (collection === DYNATRACE_PROBLEM_NOTES_COLLECTION)
      data = [
        historicalNote,
        deletedNote,
        editedNoteLatest,
        editedNoteOriginal,
        ...mocks.extraNotes,
      ];
    if (collection === DYNATRACE_PROBLEM_SYNC_COLLECTION) data = [syncRecord];
    if (collection === DYNATRACE_PROBLEMS_COLLECTION && String(options.filter).includes('OPEN'))
      data = mocks.openProblems;
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
    mocks.openProblems = [];
    mocks.extraNotes = [];
  });

  it('passes ordinary writes without attribution and retains the existing state ID', async () => {
    mocks.openProblems = [openProblem];
    const { result } = renderHook(() => useDynatraceProblems());

    await act(async () => {
      await result.current.addNote('problem-1', 'Investigating');
      await result.current.setAddressed('problem-1', true, 'new-response-note');
    });

    expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Investigating', undefined);
    expect(mocks.setAddressed).toHaveBeenCalledWith(
      'problem-1',
      true,
      'state-1',
      'new-response-note',
      undefined,
      ['HOST-1'],
    );
  });

  it('resolves the selected roster email to the analyst and offers the roster', async () => {
    const { result } = renderHook(() => useDynatraceProblems());

    await act(async () => {
      await result.current.addNote('problem-1', 'Investigating', 'paris@example.com');
    });

    expect(result.current.resolvers).toEqual([{ email: 'paris@example.com', name: 'Paris' }]);
    expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Investigating', {
      email: 'paris@example.com',
      name: 'Paris',
    });
  });

  it('preserves historical records that do not have an operator ID', () => {
    const { result } = renderHook(() => useDynatraceProblems());

    expect(result.current.stateByProblemId.get('problem-1')).toEqual(state);
    // An edit is a newer row with the same note ID; only that row is shown.
    expect(result.current.notesByProblemId.get('problem-1')).toEqual([
      historicalNote,
      editedNoteLatest,
    ]);
  });

  it.each([
    [
      'edit',
      { note: 'Historical note, corrected' },
      ['Vendor on site', 'Historical note, corrected'],
    ],
    ['delete', { note: historicalNote.note, state: 'deleted' }, ['Vendor on site']],
  ] as const)(
    'replaces a note saved before note IDs after its first %s',
    (_change, fields, expected) => {
      // The first change to a note without a note ID adopts the original record ID as its note ID.
      mocks.extraNotes = [
        {
          id: 'note-5',
          problemId: 'problem-1',
          noteId: historicalNote.id,
          created: '2026-07-09T18:05:00.000Z',
          ...fields,
        },
      ];
      const { result } = renderHook(() => useDynatraceProblems());

      expect(result.current.notesByProblemId.get('problem-1')?.map((note) => note.note)).toEqual(
        expected,
      );
    },
  );

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
