import { useEffect, useEffectEvent } from 'react';
import { isAnyModalOpen } from '../components/modalStack';
import { getRelayRuntime } from '../runtime/relayRuntime';

export type TabCommandShortcut = Readonly<{
  /** Visible keycap text for tooltips, e.g. `⌘⇧C`, `Ctrl+Shift+C` or `Alt⇧C` in the browser. */
  label: string;
  /** `aria-keyshortcuts` value matching exactly what `useTabCommandShortcuts` listens for. */
  aria: string;
}>;

/**
 * Platform label for a tab command on `letter` (an uppercase A–Z). Desktop uses Mod+Shift; Relay Web
 * uses Alt+Shift, as the global shortcuts do, because browsers keep Mod+Shift+C/B/M for DevTools,
 * the bookmarks bar and the profile menu.
 */
export function getTabCommandShortcut(letter: string): TabCommandShortcut {
  if (getRelayRuntime().kind === 'web') {
    return { label: `Alt⇧${letter}`, aria: `Alt+Shift+${letter}` };
  }
  const isMac =
    typeof globalThis.api?.platform === 'string' ? globalThis.api.platform === 'darwin' : true;
  return {
    label: isMac ? `⌘⇧${letter}` : `Ctrl+Shift+${letter}`,
    aria: isMac
      ? `Meta+Shift+${letter} Control+Shift+${letter}`
      : `Control+Shift+${letter} Meta+Shift+${letter}`,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
  );
}

/** The pressed letter (A–Z) when the event carries this runtime's tab-command modifiers. */
function commandLetter(event: KeyboardEvent, isWeb: boolean): string | null {
  const hasModifiers = isWeb
    ? event.altKey && event.shiftKey && !event.metaKey && !event.ctrlKey
    : (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey;
  // event.code, not event.key: Option/Shift compose other characters on macOS.
  const match = hasModifiers ? /^Key([A-Z])$/.exec(event.code) : null;
  return match?.[1] ?? null;
}

/**
 * Mod+Shift+letter (Alt+Shift+letter in Relay Web) commands for the visible tab. Retained tabs are
 * wrapped in `<Activity>`, so the listener only exists while its tab is shown. Typing in a field and
 * open dialogs suspend every binding; a `null` binding marks a command that is currently disabled.
 */
export function useTabCommandShortcuts(
  bindings: Readonly<Partial<Record<string, (() => void) | null>>>,
): void {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;
    const letter = commandLetter(event, getRelayRuntime().kind === 'web');
    if (!letter || !(letter in bindings)) return;
    if (isEditableTarget(event.target) || isAnyModalOpen()) return;
    event.preventDefault();
    bindings[letter]?.();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, []);
}

/** Tab commands the ⌘K palette can run. Each id belongs to exactly one tab. */
export type TabCommandId =
  'copy-all-on-call' | 'add-all-on-call-to-bridge' | 'clear-bridge' | 'reset-alert';

const TAB_COMMAND_REQUEST_EVENT = 'relay:tab-command-request';
/** A request older than this is dropped, so a tab that never mounted cannot run it later. */
const TAB_COMMAND_REQUEST_TTL_MS = 5_000;
let pendingTabCommand: { id: TabCommandId; requestedAt: number } | null = null;

/**
 * Ask the owning tab to run `id`. The caller switches to that tab first; the request waits until
 * the tab's `useTabCommandRequests` is mounted (lazy tabs load, retained tabs leave `<Activity>`).
 */
export function requestTabCommand(id: TabCommandId): void {
  pendingTabCommand = { id, requestedAt: Date.now() };
  globalThis.dispatchEvent(new Event(TAB_COMMAND_REQUEST_EVENT));
}

/**
 * Runs palette requests for the visible tab with the same handlers as its buttons. A `null`
 * handler marks a disabled command: the request is consumed and the tab shows why it is disabled.
 */
export function useTabCommandRequests(
  handlers: Readonly<Partial<Record<TabCommandId, (() => void) | null>>>,
): void {
  const consume = useEffectEvent(() => {
    const pending = pendingTabCommand;
    if (!pending || !(pending.id in handlers)) return;
    pendingTabCommand = null;
    if (Date.now() - pending.requestedAt > TAB_COMMAND_REQUEST_TTL_MS) return;
    handlers[pending.id]?.();
  });
  useEffect(() => {
    consume();
    const listener = () => consume();
    globalThis.addEventListener(TAB_COMMAND_REQUEST_EVENT, listener);
    return () => globalThis.removeEventListener(TAB_COMMAND_REQUEST_EVENT, listener);
  }, []);
}
