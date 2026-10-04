import React, { useCallback, useEffect } from 'react';
import type { ListImperativeAPI } from 'react-window';
import { Server } from '@shared/ipc';

interface ServersKeyboardProps {
  listRef: React.RefObject<ListImperativeAPI | null>;
  servers: Server[];
  focusedIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  onSelect: (server: Server) => void;
  onClearSelection: () => void;
  setContextMenu: (menu: { x: number; y: number; server: Server } | null) => void;
  listContainerRef: React.RefObject<HTMLElement | null>;
  rowHeight: number;
}

/**
 * Keyboard model for the Servers list, mirroring useDirectoryKeyboard: arrows/Home/End move the
 * focused row, Enter or Space selects it, Shift+F10 opens its context menu, Escape clears.
 */
export function useServersKeyboard({
  listRef,
  servers,
  focusedIndex,
  setFocusedIndex,
  onSelect,
  onClearSelection,
  setContextMenu,
  listContainerRef,
  rowHeight,
}: ServersKeyboardProps) {
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (servers.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = prev < servers.length - 1 ? prev + 1 : prev;
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
          setFocusedIndex(servers.length - 1);
          listRef.current?.scrollToRow({ index: servers.length - 1, align: 'end' });
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          {
            const focused = focusedIndex >= 0 ? servers[focusedIndex] : undefined;
            if (focused) onSelect(focused);
          }
          break;
        case 'F10':
          if (e.shiftKey && focusedIndex >= 0 && focusedIndex < servers.length) {
            e.preventDefault();
            const server = servers[focusedIndex];
            const listContainer = listContainerRef.current;
            if (server && listContainer) {
              const rect = listContainer.getBoundingClientRect();
              const scrollTop = listRef.current?.element?.scrollTop || 0;
              const rowTop = focusedIndex * rowHeight - scrollTop;
              setContextMenu({ x: rect.left + 100, y: rect.top + rowTop + 20, server });
            }
          }
          break;
        case 'Escape':
          setFocusedIndex(-1);
          onClearSelection();
          break;
      }
    },
    [
      servers,
      focusedIndex,
      onSelect,
      onClearSelection,
      setFocusedIndex,
      setContextMenu,
      listRef,
      listContainerRef,
      rowHeight,
    ],
  );

  useEffect(() => {
    if (focusedIndex >= servers.length) {
      setFocusedIndex(servers.length > 0 ? servers.length - 1 : -1);
    }
  }, [servers.length, focusedIndex, setFocusedIndex]);

  return { handleListKeyDown };
}
