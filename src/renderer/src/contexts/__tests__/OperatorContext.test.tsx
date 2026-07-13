import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';
import { SELECTED_OPERATOR_STORAGE_KEY } from '../../services/operatorSelection';

const { mockShowToast, mockUseCollection } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockUseCollection: vi.fn(),
}));

vi.mock('../../hooks/useCollection', () => ({
  useCollection: mockUseCollection,
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

import { OperatorProvider, useOperator } from '../OperatorContext';

type CollectionState = {
  data: RelayOperatorRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

let collectionState: CollectionState;

const makeOperator = (id: string, displayName: string, active = true): RelayOperatorRecord => ({
  id,
  displayName,
  active,
  created: '2026-07-13 12:00:00.000Z',
  updated: '2026-07-13 12:00:00.000Z',
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <OperatorProvider>{children}</OperatorProvider>
);

describe('OperatorProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    collectionState = {
      data: [],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    };
    mockUseCollection.mockImplementation(() => collectionState);
  });

  it('provides active operators in alphabetical order', () => {
    collectionState.data = [
      makeOperator('z', 'Zulu'),
      makeOperator('i', 'Inactive', false),
      makeOperator('a', 'Alpha'),
    ];

    const { result } = renderHook(() => useOperator(), { wrapper });

    expect(mockUseCollection).toHaveBeenCalledWith(RELAY_OPERATORS_COLLECTION, {
      sort: 'displayName',
    });
    expect(result.current.activeOperators.map(({ displayName }) => displayName)).toEqual([
      'Alpha',
      'Zulu',
    ]);
  });

  it('restores and updates the persisted workstation selection', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'operator-1');
    collectionState.data = [
      makeOperator('operator-1', 'Ryan Bell'),
      makeOperator('operator-2', 'Tristan Stillwell'),
    ];

    const { result } = renderHook(() => useOperator(), { wrapper });

    expect(result.current.selectedOperator?.id).toBe('operator-1');

    act(() => result.current.selectOperator('operator-2'));

    expect(result.current.selectedOperator?.id).toBe('operator-2');
    expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBe('operator-2');
  });

  it('invalidates an inactive selection once after a successful load', async () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'operator-1');
    collectionState.data = [makeOperator('operator-1', 'Ryan Bell', false)];

    const { result, rerender } = renderHook(() => useOperator(), { wrapper });

    await waitFor(() => expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBeNull());
    expect(result.current.selectedOperator).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith(
      'The selected operator is no longer active. Choose another operator.',
      'info',
    );

    rerender();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  it('clears an absent selection only after a successful load', async () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'missing-operator');

    renderHook(() => useOperator(), { wrapper });

    await waitFor(() => expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBeNull());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('preserves a stored selection through loading and transient errors', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'operator-1');
    collectionState = {
      ...collectionState,
      loading: true,
    };

    const { result, rerender } = renderHook(() => useOperator(), { wrapper });

    expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBe('operator-1');
    expect(result.current.loading).toBe(true);

    collectionState = {
      ...collectionState,
      loading: false,
      error: 'network unavailable',
    };
    rerender();

    expect(localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)).toBe('operator-1');
    expect(result.current.error).toEqual(new Error('network unavailable'));
  });

  it('opens the shared picker when attribution is required without a valid selection', () => {
    const { result } = renderHook(() => useOperator(), { wrapper });

    let attribution: ReturnType<typeof result.current.requireAttribution>;
    act(() => {
      attribution = result.current.requireAttribution();
    });

    expect(attribution!).toBeNull();
    expect(result.current.pickerOpen).toBe(true);

    act(() => result.current.setPickerOpen(false));
    expect(result.current.pickerOpen).toBe(false);
  });

  it('returns an attribution snapshot for a valid selected operator', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'operator-1');
    collectionState.data = [makeOperator('operator-1', 'Ryan Bell')];
    const { result } = renderHook(() => useOperator(), { wrapper });

    expect(result.current.requireAttribution()).toEqual({
      operatorId: 'operator-1',
      operatorName: 'Ryan Bell',
    });
    expect(result.current.pickerOpen).toBe(false);
  });
});
