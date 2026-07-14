import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
} from '@shared/dynatraceProblems';
import type { OperatorAttribution } from '@shared/operators';
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

const attribution: OperatorAttribution = {
  operatorId: 'operator-ryan',
  operatorName: 'Ryan Bell',
};

describe('useDynatraceProblems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes operator attribution and the existing state ID to mutations', async () => {
    const { result } = renderHook(() => useDynatraceProblems());

    await act(async () => {
      await result.current.addNote('problem-1', 'Investigating', attribution);
      await result.current.setAddressed('problem-1', true, attribution);
    });

    expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Investigating', attribution);
    expect(mocks.setAddressed).toHaveBeenCalledWith('problem-1', true, attribution, 'state-1');
  });

  it('preserves historical records that do not have an operator ID', () => {
    const { result } = renderHook(() => useDynatraceProblems());

    expect(result.current.stateByProblemId.get('problem-1')).toEqual(state);
    expect(result.current.notesByProblemId.get('problem-1')).toEqual([historicalNote]);
  });
});
