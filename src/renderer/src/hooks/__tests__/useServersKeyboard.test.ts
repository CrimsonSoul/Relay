import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import React from 'react';
import { useServersKeyboard } from '../useServersKeyboard';
import type { Server } from '@shared/ipc';
import type { ListImperativeAPI } from 'react-window';

// Matches ROW_HEIGHT in ServersTab, the hook's only production caller.
const ROW_HEIGHT = 67;

type ContextMenuState = { x: number; y: number; server: Server } | null;

const functionalUpdate = (
  call: [React.SetStateAction<number>] | undefined,
): ((prev: number) => number) => {
  const updater = call?.[0];
  if (typeof updater !== 'function') {
    throw new Error(`expected a functional state update, received ${String(updater)}`);
  }
  return updater;
};

const makeServer = (name: string): Server => ({
  name,
  businessArea: 'Payments',
  lob: 'Core',
  comment: '',
  owner: '',
  contact: '',
  os: 'Linux',
  _searchString: name,
  raw: {},
});

const makeKeyEvent = (key: string, extra: Partial<React.KeyboardEvent> = {}) =>
  ({
    key,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...extra,
  }) as unknown as React.KeyboardEvent;

describe('useServersKeyboard', () => {
  const servers = [makeServer('web-01'), makeServer('db-01'), makeServer('cache-01')];

  let mockScrollToRow: Mock<ListImperativeAPI['scrollToRow']>;
  let setFocusedIndex: Mock<React.Dispatch<React.SetStateAction<number>>>;
  let onSelect: Mock<(server: Server) => void>;
  let onClearSelection: Mock<() => void>;
  let setContextMenu: Mock<(menu: ContextMenuState) => void>;
  let defaultProps: Parameters<typeof useServersKeyboard>[0];

  beforeEach(() => {
    mockScrollToRow = vi.fn<ListImperativeAPI['scrollToRow']>();
    setFocusedIndex = vi.fn<React.Dispatch<React.SetStateAction<number>>>();
    onSelect = vi.fn<(server: Server) => void>();
    onClearSelection = vi.fn<() => void>();
    setContextMenu = vi.fn<(menu: ContextMenuState) => void>();

    const container = document.createElement('section');
    container.getBoundingClientRect = () => new DOMRect(100, 200, 600, 400);

    defaultProps = {
      listRef: {
        current: { scrollToRow: mockScrollToRow, element: document.createElement('div') },
      },
      servers,
      focusedIndex: 0,
      setFocusedIndex,
      onSelect,
      onClearSelection,
      setContextMenu,
      listContainerRef: { current: container },
      rowHeight: ROW_HEIGHT,
    };
  });

  it.each([
    ['ArrowDown', 0, 1],
    ['ArrowDown', 2, 2],
    ['ArrowUp', 2, 1],
    ['ArrowUp', 0, 0],
  ])('%s from row %i focuses row %i and scrolls it into view', (key, from, to) => {
    const { result } = renderHook(() => useServersKeyboard(defaultProps));

    const event = makeKeyEvent(key);
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(functionalUpdate(setFocusedIndex.mock.calls[0])(from)).toBe(to);
    expect(mockScrollToRow).toHaveBeenCalledWith({ index: to, align: 'smart' });
  });

  it('jumps to the first and last rows on Home and End', () => {
    const { result } = renderHook(() => useServersKeyboard({ ...defaultProps, focusedIndex: 1 }));

    result.current.handleListKeyDown(makeKeyEvent('Home'));
    expect(setFocusedIndex).toHaveBeenLastCalledWith(0);
    expect(mockScrollToRow).toHaveBeenLastCalledWith({ index: 0, align: 'start' });

    result.current.handleListKeyDown(makeKeyEvent('End'));
    expect(setFocusedIndex).toHaveBeenLastCalledWith(2);
    expect(mockScrollToRow).toHaveBeenLastCalledWith({ index: 2, align: 'end' });
  });

  it.each(['Enter', ' '])('selects the focused server on %j', (key) => {
    const { result } = renderHook(() => useServersKeyboard({ ...defaultProps, focusedIndex: 1 }));

    const event = makeKeyEvent(key);
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(servers[1]);
  });

  it('opens the context menu for the focused server on Shift+F10', () => {
    const { result } = renderHook(() => useServersKeyboard({ ...defaultProps, focusedIndex: 1 }));

    const event = makeKeyEvent('F10', { shiftKey: true });
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(setContextMenu).toHaveBeenCalledWith({
      x: 200,
      y: 200 + ROW_HEIGHT + 20,
      server: servers[1],
    });
  });

  it('ignores plain F10 and Shift+F10 without a focused row', () => {
    const { result, rerender } = renderHook((props) => useServersKeyboard(props), {
      initialProps: defaultProps,
    });

    result.current.handleListKeyDown(makeKeyEvent('F10'));
    rerender({ ...defaultProps, focusedIndex: -1 });
    result.current.handleListKeyDown(makeKeyEvent('F10', { shiftKey: true }));

    expect(setContextMenu).not.toHaveBeenCalled();
  });

  it('clears focus and selection on Escape', () => {
    const { result } = renderHook(() => useServersKeyboard(defaultProps));

    result.current.handleListKeyDown(makeKeyEvent('Escape'));

    expect(setFocusedIndex).toHaveBeenCalledWith(-1);
    expect(onClearSelection).toHaveBeenCalled();
  });

  it('does nothing on an empty list', () => {
    const { result } = renderHook(() =>
      useServersKeyboard({ ...defaultProps, servers: [], focusedIndex: -1 }),
    );

    const event = makeKeyEvent('ArrowDown');
    result.current.handleListKeyDown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setFocusedIndex).not.toHaveBeenCalled();
  });

  it('clamps a focused index past the end of a shrunken list', () => {
    renderHook(() => useServersKeyboard({ ...defaultProps, focusedIndex: 5 }));

    expect(setFocusedIndex).toHaveBeenCalledWith(2);
  });
});
