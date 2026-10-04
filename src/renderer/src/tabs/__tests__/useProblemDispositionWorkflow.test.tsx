import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast }),
}));

import {
  LAST_RESOLVER_STORAGE_KEY,
  RESOLVER_REQUIRED_MESSAGE,
  useProblemDispositionWorkflow,
} from '../useProblemDispositionWorkflow';

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
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

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
    expect(result.current.resolverDraft).toBe('Ryan');
  });

  it('keeps note text typed while the response was saving', async () => {
    const resolvers: Array<(value: { id: string }) => void> = [];
    const addNote = vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { result } = renderHook(() =>
      useProblemDispositionWorkflow({
        selectedProblem: problem,
        selectedState: undefined,
        addNote: addNote as never,
        setAddressed: vi.fn() as never,
      }),
    );
    act(() => {
      result.current.setResolverDraft('Ryan');
      result.current.setNoteDraft('First update');
    });
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.handleSaveResponse();
    });
    act(() => result.current.setNoteDraft('First update, then more'));
    await act(async () => {
      resolvers[0]?.({ id: 'response-note' });
      await saving;
    });

    expect(addNote).toHaveBeenCalledWith(problem.problemId, 'First update', 'Ryan');
    expect(result.current.noteDraft).toBe('First update, then more');
  });

  it('defaults the next problem to the last resolver without treating it as an unsaved draft', async () => {
    const addNote = vi.fn(async () => ({ id: 'response-note' }));
    const setAddressed = vi.fn(async () => ({}));
    const nextProblem = { ...problem, id: 'problem-record-2', problemId: 'problem-2' };
    const { result, rerender } = renderHook(
      ({ selectedProblem }) =>
        useProblemDispositionWorkflow({
          selectedProblem,
          selectedState: undefined,
          addNote: addNote as never,
          setAddressed: setAddressed as never,
        }),
      { initialProps: { selectedProblem: problem } },
    );

    act(() => {
      result.current.setResolverDraft('Ryan');
      result.current.setNoteDraft('Restarted the payment pods');
    });
    await act(async () => result.current.handleAddressToggle());
    rerender({ selectedProblem: nextProblem });

    expect(localStorage.getItem(LAST_RESOLVER_STORAGE_KEY)).toBe('Ryan');
    expect(result.current.resolverDraft).toBe('Ryan');
    // Auto-reselection is held while a draft exists, so the default must not count as one.
    expect(result.current.hasUnsavedDraft).toBe(false);
  });

  it('ignores a remembered resolver that is no longer on the roster', () => {
    localStorage.setItem(LAST_RESOLVER_STORAGE_KEY, 'Former Teammate');
    const { result } = renderHook(() =>
      useProblemDispositionWorkflow({
        selectedProblem: problem,
        selectedState: undefined,
        addNote: vi.fn() as never,
        setAddressed: vi.fn() as never,
      }),
    );

    expect(result.current.resolverDraft).toBe('');
  });

  it('reports a missing resolver inline at the select instead of a toast', async () => {
    const addNote = vi.fn(async () => ({ id: 'response-note' }));
    const setAddressed = vi.fn(async () => ({}));
    const select = document.createElement('select');
    document.body.append(select);
    const resolverSelectRef = { current: select };
    const { result } = renderHook(() =>
      useProblemDispositionWorkflow({
        selectedProblem: problem,
        selectedState: undefined,
        addNote,
        setAddressed,
        resolverSelectRef,
      }),
    );

    act(() => result.current.setNoteDraft('Investigating payment latency'));
    await act(async () => result.current.handleAddressToggle());

    expect(result.current.resolverError).toBe(RESOLVER_REQUIRED_MESSAGE);
    expect(document.activeElement).toBe(select);
    expect(showToast).not.toHaveBeenCalled();
    expect(setAddressed).not.toHaveBeenCalled();

    act(() => result.current.setResolverDraft('Ryan'));
    expect(result.current.resolverError).toBe('');
    select.remove();
  });
});
