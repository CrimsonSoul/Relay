import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast }),
}));

import { useProblemDispositionWorkflow } from '../useProblemDispositionWorkflow';

const problem: DynatraceProblemRecord = {
  id: 'problem-record',
  problemId: 'problem-1',
  displayId: 'P-1',
  title: 'Payment latency',
  status: 'OPEN',
  severity: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: 1,
  endTime: -1,
  rootCauseName: '',
  affectedEntities: [],
  impactedEntities: [],
  managementZones: [],
  alertingProfiles: [],
  environmentUrl: 'https://example.live.dynatrace.com',
  syncedAt: '2026-08-23T12:00:00.000Z',
};

describe('useProblemDispositionWorkflow', () => {
  it('persists the attributed response before marking a problem addressed', async () => {
    const addNote = vi.fn(async () => ({ id: 'response-note' }));
    const setAddressed = vi.fn(async () => ({}));
    const { result } = renderHook(() =>
      useProblemDispositionWorkflow({
        selectedProblem: problem,
        selectedState: undefined,
        addNote: addNote as never,
        setAddressed: setAddressed as never,
      }),
    );

    act(() => {
      result.current.setResolverDraft('Ryan');
      result.current.setNoteDraft('Investigating payment latency');
    });
    await act(async () => result.current.handleAddressToggle());

    expect(addNote).toHaveBeenCalledWith(
      problem.problemId,
      'Investigating payment latency',
      'Ryan',
    );
    expect(setAddressed).toHaveBeenCalledWith(problem.problemId, true, 'response-note', 'Ryan');
    await waitFor(() => expect(result.current.savingAction).toBeNull());
    expect(result.current.noteDraft).toBe('');
    expect(result.current.resolverDraft).toBe('');
  });
});
