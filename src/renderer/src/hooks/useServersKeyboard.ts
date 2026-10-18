import React, { useCallback } from 'react';
import type { ListImperativeAPI } from 'react-window';
import { Server } from '@shared/ipc';
import { useVirtualListKeyboard } from './useVirtualListKeyboard';

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
 * Servers list keyboard model (see useVirtualListKeyboard): Enter or Space selects the server and
 * Escape also clears the selection.
 */
export function useServersKeyboard({
  servers,
  onSelect,
  onClearSelection,
  setContextMenu,
  ...list
}: ServersKeyboardProps) {
  const onContextMenu = useCallback(
    (server: Server, x: number, y: number) => setContextMenu({ x, y, server }),
    [setContextMenu],
  );
  return useVirtualListKeyboard({
    ...list,
    items: servers,
    onActivate: onSelect,
    onContextMenu,
    onEscape: onClearSelection,
  });
}
