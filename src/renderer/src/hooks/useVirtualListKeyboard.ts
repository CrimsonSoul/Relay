import React, { useCallback, useEffect } from 'react';
import type { ListImperativeAPI } from 'react-window';

export interface VirtualListKeyboardOptions<T> {
  listRef: React.RefObject<ListImperativeAPI | null>;
  items: readonly T[];
  focusedIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  /** Enter or Space on the focused row. */
  onActivate: (item: T) => void;
  /** Shift+F10 on the focused row, at a point inside it. */
  onContextMenu: (item: T, x: number, y: number) => void;
  /** Escape, after the focus is cleared. */
  onEscape?: () => void;
  listContainerRef: React.RefObject<HTMLElement | null>;
  rowHeight: number;
}

/**
 * Keyboard model shared by Relay's virtualized lists: arrows/Home/End move the focused row and
 * scroll it into view, Enter or Space activates it, Shift+F10 opens its context menu, Escape
 * clears the focus. The focused index is clamped when the list shrinks.
 */
export function useVirtualListKeyboard<T>({
  listRef,
  items,
  focusedIndex,
  setFocusedIndex,
  onActivate,
  onContextMenu,
  onEscape,
  listContainerRef,
  rowHeight,
}: VirtualListKeyboardOptions<T>) {
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (items.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = prev < items.length - 1 ? prev + 1 : prev;
            listRef.current?.scrollToRow({ index: next, align: 'smart' });
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : 0;
            listRef.current?.scrollToRow({ index: next, align: 'smart' });
            return next;
          });
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          listRef.current?.scrollToRow({ index: 0, align: 'start' });
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(items.length - 1);
          listRef.current?.scrollToRow({ index: items.length - 1, align: 'end' });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          {
            const focused = focusedIndex >= 0 ? items[focusedIndex] : undefined;
            if (focused) onActivate(focused);
          }
          break;
        case 'F10':
          if (e.shiftKey && focusedIndex >= 0 && focusedIndex < items.length) {
            e.preventDefault();
            const item = items[focusedIndex];
            const listContainer = listContainerRef.current;
            if (item && listContainer) {
              const rect = listContainer.getBoundingClientRect();
              const scrollTop = listRef.current?.element?.scrollTop || 0;
              const rowTop = focusedIndex * rowHeight - scrollTop;
              onContextMenu(item, rect.left + 100, rect.top + rowTop + 20);
            }
          }
          break;
        case 'Escape':
          setFocusedIndex(-1);
          onEscape?.();
          break;
      }
    },
    [
      items,
      focusedIndex,
      onActivate,
      onContextMenu,
      onEscape,
      setFocusedIndex,
      listRef,
      listContainerRef,
      rowHeight,
    ],
  );

  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(items.length > 0 ? items.length - 1 : -1);
    }
  }, [items.length, focusedIndex, setFocusedIndex]);

  return { handleListKeyDown };
}
