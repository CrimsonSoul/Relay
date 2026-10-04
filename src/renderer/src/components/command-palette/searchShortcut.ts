import { getRelayRuntime } from '../../runtime/relayRuntime';

export type GlobalShortcut = {
  /** Visible keycap text, e.g. `⌘1`, `Ctrl+1` or `Alt⇧1` in the browser. */
  label: string;
  /** `aria-keyshortcuts` value matching the keys `useKeyboardShortcuts` listens for. */
  aria: string;
};

/**
 * Platform label for an app-wide shortcut on `key`. Desktop listens for Cmd or Ctrl; Relay Web uses
 * Alt+Shift so browser tab and search bindings stay available.
 */
export function getGlobalShortcut(key: string): GlobalShortcut {
  if (getRelayRuntime().kind === 'web') {
    return { label: `Alt⇧${key}`, aria: `Alt+Shift+${key}` };
  }
  const isMac =
    typeof globalThis.api?.platform === 'string' ? globalThis.api.platform === 'darwin' : true;
  return {
    label: isMac ? `\u2318${key}` : `Ctrl+${key}`,
    aria: isMac ? `Meta+${key} Control+${key}` : `Control+${key} Meta+${key}`,
  };
}

/** Platform label for the global search shortcut (⌘K, Ctrl+K, or Alt⇧K in the browser). */
export function getSearchShortcutLabel(): string {
  return getGlobalShortcut('K').label;
}
