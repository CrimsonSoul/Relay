import { useEffect, RefObject } from 'react';
import { TabName } from '@shared/ipc';

interface UseKeyboardShortcutsParams {
  setActiveTab: (tab: TabName) => void;
  setSettingsOpen: (open: boolean) => void;
  setIsShortcutsOpen: (open: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement>;
}

export function useKeyboardShortcuts({
  setActiveTab,
  setSettingsOpen,
  setIsShortcutsOpen,
  searchInputRef,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const tabMap: Record<string, string> = {
      '1': 'Compose',
      '2': 'Personnel',
      '3': 'People',
      '4': 'Servers',
      '5': 'Status',
      '6': 'Notes',
      '7': 'Alerts',
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K to focus header search bar
      if (mod && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Cmd/Ctrl+, for Settings
      if (mod && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }

      // Cmd/Ctrl+? for Shortcuts (Shift+/)
      if (mod && e.shiftKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      // Cmd/Ctrl+1-9 for tab navigation
      if (mod && !e.shiftKey && tabMap[e.key]) {
        e.preventDefault();
        setActiveTab(tabMap[e.key] as TabName);
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab, setSettingsOpen, setIsShortcutsOpen, searchInputRef]);
}
