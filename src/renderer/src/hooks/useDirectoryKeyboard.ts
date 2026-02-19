import React, { useCallback, useEffect } from 'react';
import type { ListImperativeAPI } from 'react-window';
import { Contact } from '@shared/ipc';

interface DirectoryKeyboardProps {
  listRef: React.RefObject<ListImperativeAPI | null>;
  filtered: Contact[];
  focusedIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  handleAddWrapper: (contact: Contact) => void;
  setContextMenu: (menu: { x: number; y: number; contact: Contact } | null) => void;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useDirectoryKeyboard({
  listRef,
  filtered,
  focusedIndex,
  setFocusedIndex,
  handleAddWrapper,
  setContextMenu,
  listContainerRef,
}: DirectoryKeyboardProps) {
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = prev < filtered.length - 1 ? prev + 1 : prev;
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
          setFocusedIndex(filtered.length - 1);
          listRef.current?.scrollToRow({ index: filtered.length - 1, align: 'end' });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < filtered.length) {
            handleAddWrapper(filtered[focusedIndex]);
          }
          break;
        case 'F10':
          if (e.shiftKey && focusedIndex >= 0 && focusedIndex < filtered.length) {
            e.preventDefault();
            const contact = filtered[focusedIndex];
            const listContainer = listContainerRef.current;
            if (listContainer) {
              const rect = listContainer.getBoundingClientRect();
              const scrollTop = listRef.current?.element?.scrollTop || 0;
              const rowTop = focusedIndex * 40 - scrollTop;
              setContextMenu({ x: rect.left + 100, y: rect.top + rowTop + 20, contact });
            }
          }
          break;
        case 'Escape':
          setFocusedIndex(-1);
          break;
      }
    },
    [
      filtered,
      focusedIndex,
      handleAddWrapper,
      setFocusedIndex,
      setContextMenu,
      listRef,
      listContainerRef,
    ],
  );

  useEffect(() => {
    if (focusedIndex >= filtered.length) {
      setFocusedIndex(filtered.length > 0 ? filtered.length - 1 : -1);
    }
  }, [filtered.length, focusedIndex, setFocusedIndex]);

  return { handleListKeyDown };
}
