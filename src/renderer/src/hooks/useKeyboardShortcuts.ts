import { useEffect, RefObject } from 'react';
import { TabName } from '@shared/ipc';
import { isAnyModalOpen } from '../components/modalStack';
import { getRelayRuntime } from '../runtime/relayRuntime';
import { getSidebarOrder } from '../components/sidebar/sidebarOrder';

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

/** Digits 1–8 open the sidebar destinations in the person's saved order. */
function tabAtDigit(digit: string): TabName | undefined {
  return /^[1-8]$/.test(digit) ? getSidebarOrder()[Number(digit) - 1] : undefined;
}

const WEB_SHORTCUTS: Partial<Record<string, ShortcutAction>> = {
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
  const tab = tabAtDigit(event.key);
  return !event.shiftKey && tab ? { kind: 'navigate', tab } : null;
}

function webShortcutAction(event: KeyboardEvent): ShortcutAction | null {
  const hasWebModifier = event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey;
  if (!hasWebModifier) return null;
  const tab = tabAtDigit(event.code.replace(/^Digit/, ''));
  return tab ? { kind: 'navigate', tab } : (WEB_SHORTCUTS[event.code] ?? null);
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
