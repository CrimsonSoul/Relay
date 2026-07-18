import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
} from '@shared/dynatraceProblems';
import { useDynatraceProblems } from '../useDynatraceProblems';

const mocks = vi.hoisted(() => ({
  addNote: vi.fn(),
  setAddressed: vi.fn(),
  refetch: vi.fn(async () => undefined),
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
  useCollection: (collection: string) => {
    let data: object[] = [];
    if (collection === DYNATRACE_PROBLEM_STATES_COLLECTION) data = [state];
    if (collection === DYNATRACE_PROBLEM_NOTES_COLLECTION) data = [historicalNote];
    return {
      data,
      loading: false,
      error: null,
      refetch: mocks.refetch,
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
});
