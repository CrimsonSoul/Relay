import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useAppAssembler } from '../useAppAssembler';
import type { Contact } from '@shared/ipc';

describe('useAppAssembler', () => {
  const makeContact = (email: string): Contact => ({
    name: email.split('@')[0],
    email,
    phone: '',
    title: '',
    _searchString: email.toLowerCase(),
    raw: {},
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useAppAssembler());

    expect(result.current.activeTab).toBe('Compose');
    expect(result.current.selectedGroupIds).toEqual([]);
    expect(result.current.manualAdds).toEqual([]);
    expect(result.current.manualRemoves).toEqual([]);
    expect(result.current.settingsOpen).toBe(false);
  });

  it('toggles group selection on and off', () => {
    const { result } = renderHook(() => useAppAssembler());

    act(() => {
      result.current.handleToggleGroup('g1');
    });
    expect(result.current.selectedGroupIds).toEqual(['g1']);

    act(() => {
      result.current.handleToggleGroup('g2');
    });
    expect(result.current.selectedGroupIds).toEqual(['g1', 'g2']);

    // Toggle off
    act(() => {
      result.current.handleToggleGroup('g1');
    });
    expect(result.current.selectedGroupIds).toEqual(['g2']);
  });

  it('adds manual emails without duplicates', () => {
    const { result } = renderHook(() => useAppAssembler());

    act(() => {
      result.current.handleAddManual('alice@test.com');
    });
    expect(result.current.manualAdds).toEqual(['alice@test.com']);

    // Adding same email should not duplicate
    act(() => {
      result.current.handleAddManual('alice@test.com');
    });
    expect(result.current.manualAdds).toEqual(['alice@test.com']);

    act(() => {
      result.current.handleAddManual('bob@test.com');
    });
    expect(result.current.manualAdds).toEqual(['alice@test.com', 'bob@test.com']);
  });

  it('removes manual emails', () => {
    const { result } = renderHook(() => useAppAssembler());

    act(() => {
      result.current.handleRemoveManual('alice@test.com');
    });
    expect(result.current.manualRemoves).toEqual(['alice@test.com']);

    act(() => {
      result.current.handleRemoveManual('bob@test.com');
    });
    expect(result.current.manualRemoves).toEqual(['alice@test.com', 'bob@test.com']);
  });

  it('undoes the last remove', () => {
    const { result } = renderHook(() => useAppAssembler());

    act(() => {
      result.current.handleRemoveManual('alice@test.com');
      result.current.handleRemoveManual('bob@test.com');
    });

    act(() => {
      result.current.handleUndoRemove();
    });
    expect(result.current.manualRemoves).toEqual(['alice@test.com']);

    act(() => {
      result.current.handleUndoRemove();
    });
    expect(result.current.manualRemoves).toEqual([]);
  });

  it('resets all state', () => {
    const { result } = renderHook(() => useAppAssembler());

    act(() => {
      result.current.handleToggleGroup('g1');
      result.current.handleAddManual('alice@test.com');
      result.current.handleRemoveManual('bob@test.com');
    });

    expect(result.current.selectedGroupIds).toHaveLength(1);
    expect(result.current.manualAdds).toHaveLength(1);
    expect(result.current.manualRemoves).toHaveLength(1);

    act(() => {
      result.current.handleReset();
    });

    expect(result.current.selectedGroupIds).toEqual([]);
    expect(result.current.manualAdds).toEqual([]);
    expect(result.current.manualRemoves).toEqual([]);
  });

  it('handleAddToAssembler adds email and clears it from removes', () => {
    const { result } = renderHook(() => useAppAssembler());

    // First remove an email
    act(() => {
      result.current.handleRemoveManual('alice@test.com');
    });
    expect(result.current.manualRemoves).toContain('alice@test.com');

    // Now add it back via handleAddToAssembler
    act(() => {
      result.current.handleAddToAssembler(makeContact('alice@test.com'));
    });

    expect(result.current.manualAdds).toContain('alice@test.com');
    expect(result.current.manualRemoves).not.toContain('alice@test.com');
  });

  it('handleAddToAssembler does not add duplicate', () => {
    const { result } = renderHook(() => useAppAssembler());

    act(() => {
      result.current.handleAddToAssembler(makeContact('alice@test.com'));
    });
    act(() => {
      result.current.handleAddToAssembler(makeContact('alice@test.com'));
    });

    expect(result.current.manualAdds).toEqual(['alice@test.com']);
  });
});
