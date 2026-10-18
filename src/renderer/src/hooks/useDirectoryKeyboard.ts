import React, { useCallback } from 'react';
import type { ListImperativeAPI } from 'react-window';
import { Contact } from '@shared/ipc';
import { useVirtualListKeyboard } from './useVirtualListKeyboard';

interface DirectoryKeyboardProps {
  listRef: React.RefObject<ListImperativeAPI | null>;
  filtered: Contact[];
  focusedIndex: number;
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>;
  handleAddWrapper: (contact: Contact) => void;
  setContextMenu: (menu: { x: number; y: number; contact: Contact } | null) => void;
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
}

/** Directory list keyboard model (see useVirtualListKeyboard); Enter or Space adds the contact. */
export function useDirectoryKeyboard({
  filtered,
  handleAddWrapper,
  setContextMenu,
  ...list
}: DirectoryKeyboardProps) {
  const onContextMenu = useCallback(
    (contact: Contact, x: number, y: number) => setContextMenu({ x, y, contact }),
    [setContextMenu],
  );
  return useVirtualListKeyboard({
    ...list,
    items: filtered,
    onActivate: handleAddWrapper,
    onContextMenu,
  });
}
