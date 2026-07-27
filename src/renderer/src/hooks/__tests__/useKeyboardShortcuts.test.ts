import React from 'react';
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { useModalStack } from '../../components/modalStack';

describe('useKeyboardShortcuts', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['1', 'Compose'],
    ['2', 'Alerts'],
    ['3', 'Personnel'],
    ['4', 'Knowledge'],
    ['5', 'Status'],
    ['6', 'Problems'],
  ] as const)('maps Cmd+%s to %s', (key, tab) => {
    const setActiveTab = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        setActiveTab,
        openSettings: vi.fn(),
        setIsShortcutsOpen: vi.fn(),
        searchInputRef: React.createRef<HTMLInputElement>(),
      }),
    );

    fireEvent.keyDown(window, { key, metaKey: true });

    expect(setActiveTab).toHaveBeenCalledWith(tab);
  });

  it('ignores tab navigation while a modal is open, and resumes once it closes', () => {
    const setActiveTab = vi.fn();
    const { rerender } = renderHook(
      ({ modalOpen }: { modalOpen: boolean }) => {
        useModalStack('shortcut-test-modal', modalOpen);
        useKeyboardShortcuts({
          setActiveTab,
          openSettings: vi.fn(),
          setIsShortcutsOpen: vi.fn(),
          searchInputRef: React.createRef<HTMLInputElement>(),
        });
      },
      { initialProps: { modalOpen: true } },
    );

    fireEvent.keyDown(window, { key: '1', metaKey: true });

    expect(setActiveTab).not.toHaveBeenCalled();

    rerender({ modalOpen: false });
    fireEvent.keyDown(window, { key: '1', metaKey: true });

    expect(setActiveTab).toHaveBeenCalledWith('Compose');
  });

  it.each(['7', '8', '9'])('leaves Cmd+%s unassigned', (key) => {
    const setActiveTab = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        setActiveTab,
        openSettings: vi.fn(),
        setIsShortcutsOpen: vi.fn(),
        searchInputRef: React.createRef<HTMLInputElement>(),
      }),
    );

    fireEvent.keyDown(window, { key, metaKey: true });

    expect(setActiveTab).not.toHaveBeenCalled();
  });
});
