import { useEffect, RefObject } from 'react';
import { TabName } from '@shared/ipc';
import { isAnyModalOpen } from '../components/modalStack';

interface UseKeyboardShortcutsParams {
  setActiveTab: (tab: TabName) => void;
  openSettings: () => void;
  setIsShortcutsOpen: (open: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}

export function useKeyboardShortcuts({
  setActiveTab,
  openSettings,
  setIsShortcutsOpen,
  searchInputRef,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const tabMap: Partial<Record<string, TabName>> = {
      '1': 'Compose',
      '2': 'Alerts',
      '3': 'Personnel',
      '4': 'Knowledge',
      '5': 'Status',
      '6': 'Problems',
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
        openSettings();
        return;
      }

      // Cmd/Ctrl+? for Shortcuts (Shift+/)
      if (mod && e.shiftKey && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      // Cmd/Ctrl+1-6 for top-level navigation
      const destination = tabMap[e.key];
      if (mod && !e.shiftKey && destination) {
        e.preventDefault();
        // Switching the tab underneath an open modal strands the dialog over a
        // context the user never opened it from — swallow the shortcut instead.
        if (isAnyModalOpen()) return;
        setActiveTab(destination);
      }
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab, openSettings, setIsShortcutsOpen, searchInputRef]);
}
