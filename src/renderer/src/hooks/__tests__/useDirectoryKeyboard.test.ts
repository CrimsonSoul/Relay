import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useDirectoryKeyboard } from '../useDirectoryKeyboard';
import type { Contact } from '@shared/ipc';
import type { ListImperativeAPI } from 'react-window';

const makeContact = (email: string): Contact => ({
  name: email.split('@')[0],
  email,
  phone: '',
  title: '',
  _searchString: email.toLowerCase(),
  raw: {},
});

const makeKeyEvent = (key: string, extra: Partial<React.KeyboardEvent> = {}) =>
  ({
    key,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...extra,
  }) as unknown as React.KeyboardEvent;

describe('useDirectoryKeyboard', () => {
  const filtered = [
    makeContact('alice@test.com'),
    makeContact('bob@test.com'),
    makeContact('charlie@test.com'),
  ];

  let mockScrollToRow: ReturnType<typeof vi.fn>;
  let listRef: {
    current: { scrollToRow: ReturnType<typeof vi.fn>; element: { scrollTop: number } };
  };
  let listContainerRef: { current: null };
  let setFocusedIndex: ReturnType<typeof vi.fn>;
  let handleAddWrapper: ReturnType<typeof vi.fn>;
  let setContextMenu: ReturnType<typeof vi.fn>;

  let defaultProps: Parameters<typeof useDirectoryKeyboard>[0];

  beforeEach(() => {
    mockScrollToRow = vi.fn();
    listRef = { current: { scrollToRow: mockScrollToRow, element: { scrollTop: 0 } } };
    listContainerRef = { current: null };
    setFocusedIndex = vi.fn();
    handleAddWrapper = vi.fn();
    setContextMenu = vi.fn();

    defaultProps = {
      listRef: listRef as React.RefObject<ListImperativeAPI | null>,
      filtered,
      focusedIndex: 0,
      setFocusedIndex,
      handleAddWrapper,
      setContextMenu,
      listContainerRef: listContainerRef as React.RefObject<HTMLDivElement | null>,
    };
  });

  it('moves focus down on ArrowDown', () => {
    const { result } = renderHook(() => useDirectoryKeyboard(defaultProps));

    const event = makeKeyEvent('ArrowDown');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(setFocusedIndex).toHaveBeenCalled();

    // Call the updater function
    const updater = setFocusedIndex.mock.calls[0][0];
    expect(updater(0)).toBe(1); // 0 -> 1
    expect(updater(2)).toBe(2); // At end, stays at end
  });

  it('moves focus up on ArrowUp', () => {
    const { result } = renderHook(() => useDirectoryKeyboard({ ...defaultProps, focusedIndex: 1 }));

    const event = makeKeyEvent('ArrowUp');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    const updater = setFocusedIndex.mock.calls[0][0];
    expect(updater(1)).toBe(0); // 1 -> 0
    expect(updater(0)).toBe(0); // At start, stays at start
  });

  it('jumps to start on Home', () => {
    const { result } = renderHook(() => useDirectoryKeyboard({ ...defaultProps, focusedIndex: 2 }));

    const event = makeKeyEvent('Home');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(setFocusedIndex).toHaveBeenCalledWith(0);
    expect(mockScrollToRow).toHaveBeenCalledWith({ index: 0, align: 'start' });
  });

  it('jumps to end on End', () => {
    const { result } = renderHook(() => useDirectoryKeyboard(defaultProps));

    const event = makeKeyEvent('End');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(setFocusedIndex).toHaveBeenCalledWith(2);
    expect(mockScrollToRow).toHaveBeenCalledWith({ index: 2, align: 'end' });
  });

  it('adds focused contact on Enter', () => {
    const { result } = renderHook(() => useDirectoryKeyboard({ ...defaultProps, focusedIndex: 1 }));

    const event = makeKeyEvent('Enter');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(handleAddWrapper).toHaveBeenCalledWith(filtered[1]);
  });

  it('adds focused contact on Space', () => {
    const { result } = renderHook(() => useDirectoryKeyboard({ ...defaultProps, focusedIndex: 0 }));

    const event = makeKeyEvent(' ');
    result.current.handleListKeyDown(event);

    expect(handleAddWrapper).toHaveBeenCalledWith(filtered[0]);
  });

  it('clears focus on Escape', () => {
    const { result } = renderHook(() => useDirectoryKeyboard(defaultProps));

    const event = makeKeyEvent('Escape');
    result.current.handleListKeyDown(event);

    expect(setFocusedIndex).toHaveBeenCalledWith(-1);
  });

  it('does nothing on keydown when filtered list is empty', () => {
    const { result } = renderHook(() =>
      useDirectoryKeyboard({ ...defaultProps, filtered: [], focusedIndex: -1 }),
    );

    // Clear any calls from the bounds-adjustment useEffect
    setFocusedIndex.mockClear();

    const event = makeKeyEvent('ArrowDown');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setFocusedIndex).not.toHaveBeenCalled();
  });

  it('does not add on Enter when focusedIndex is out of range', () => {
    const { result } = renderHook(() =>
      useDirectoryKeyboard({ ...defaultProps, focusedIndex: -1 }),
    );

    const event = makeKeyEvent('Enter');
    result.current.handleListKeyDown(event);

    expect(handleAddWrapper).not.toHaveBeenCalled();
  });

  it('opens context menu on Shift+F10', () => {
    const containerEl = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 200,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
    };
    const localListContainerRef = { current: containerEl };

    const { result } = renderHook(() =>
      useDirectoryKeyboard({
        ...defaultProps,
        focusedIndex: 1,
        listContainerRef: localListContainerRef as React.RefObject<HTMLDivElement | null>,
      }),
    );

    const event = makeKeyEvent('F10', { shiftKey: true });
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(setContextMenu).toHaveBeenCalledTimes(1);
    const menuArg = setContextMenu.mock.calls[0][0];
    expect(menuArg).not.toBeNull();
    expect(menuArg.contact).toBe(filtered[1]);
    expect(typeof menuArg.x).toBe('number');
    expect(typeof menuArg.y).toBe('number');
  });

  it('does not open context menu on Shift+F10 when focusedIndex is -1', () => {
    const { result } = renderHook(() =>
      useDirectoryKeyboard({ ...defaultProps, focusedIndex: -1 }),
    );

    const event = makeKeyEvent('F10', { shiftKey: true });
    result.current.handleListKeyDown(event);

    expect(setContextMenu).not.toHaveBeenCalled();
  });
});
