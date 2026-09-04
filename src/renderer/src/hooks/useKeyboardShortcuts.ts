import { useEffect, RefObject } from 'react';
import { TabName } from '@shared/ipc';
import { isAnyModalOpen } from '../components/modalStack';
import { getRelayRuntime } from '../runtime/relayRuntime';

interface UseKeyboardShortcutsParams {
  setActiveTab: (tab: TabName) => void;
  openSettings: () => void;
  setIsShortcutsOpen: (open: boolean) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}

type ShortcutAction =
  | { kind: 'navigate'; tab: TabName }
  | { kind: 'focus-search' }
  | { kind: 'open-settings' }
  | { kind: 'show-shortcuts' };

const DESKTOP_TAB_SHORTCUTS: Partial<Record<string, TabName>> = {
  '1': 'Compose',
  '2': 'Alerts',
  '3': 'Personnel',
  '4': 'Knowledge',
  '5': 'Status',
  '6': 'Problems',
  '7': 'Radar',
};

const WEB_SHORTCUTS: Partial<Record<string, ShortcutAction>> = {
  Digit1: { kind: 'navigate', tab: 'Compose' },
  Digit2: { kind: 'navigate', tab: 'Alerts' },
  Digit3: { kind: 'navigate', tab: 'Personnel' },
  Digit4: { kind: 'navigate', tab: 'Knowledge' },
  Digit5: { kind: 'navigate', tab: 'Status' },
  Digit6: { kind: 'navigate', tab: 'Problems' },
  Digit7: { kind: 'navigate', tab: 'Radar' },
  KeyK: { kind: 'focus-search' },
  Comma: { kind: 'open-settings' },
  Slash: { kind: 'show-shortcuts' },
};

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
  );
}

function desktopShortcutAction(event: KeyboardEvent): ShortcutAction | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  if (event.key === 'k') return { kind: 'focus-search' };
  if (event.key === ',') return { kind: 'open-settings' };
  if (event.shiftKey && (event.key === '/' || event.key === '?')) {
    return { kind: 'show-shortcuts' };
  }
  const tab = DESKTOP_TAB_SHORTCUTS[event.key];
  return !event.shiftKey && tab ? { kind: 'navigate', tab } : null;
}

function webShortcutAction(event: KeyboardEvent): ShortcutAction | null {
  const hasWebModifier = event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey;
  return hasWebModifier ? (WEB_SHORTCUTS[event.code] ?? null) : null;
}

function runShortcutAction(
  action: ShortcutAction,
  { setActiveTab, openSettings, setIsShortcutsOpen, searchInputRef }: UseKeyboardShortcutsParams,
): void {
  if (action.kind === 'navigate') {
    setActiveTab(action.tab);
  } else if (action.kind === 'focus-search') {
    searchInputRef.current?.focus();
  } else if (action.kind === 'open-settings') {
    openSettings();
  } else {
    setIsShortcutsOpen(true);
  }
}

export function useKeyboardShortcuts({
  setActiveTab,
  openSettings,
  setIsShortcutsOpen,
  searchInputRef,
}: UseKeyboardShortcutsParams): void {
  useEffect(() => {
    const isWeb = getRelayRuntime().kind === 'web';
    const shortcutParams = { setActiveTab, openSettings, setIsShortcutsOpen, searchInputRef };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableShortcutTarget(e.target)) return;
      const action = isWeb ? webShortcutAction(e) : desktopShortcutAction(e);
      if (!action) return;
      e.preventDefault();
      // Moving the app underneath an open modal strands the dialog over a context
      // the operator never opened it from, so recognized commands are swallowed.
      if (isAnyModalOpen()) return;
      runShortcutAction(action, shortcutParams);
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab, openSettings, setIsShortcutsOpen, searchInputRef]);
}
