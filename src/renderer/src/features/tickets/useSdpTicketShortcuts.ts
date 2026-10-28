import { useEffect, useEffectEvent } from 'react';
import { isAnyModalOpen } from '../../components/modalStack';

type SdpTicketShortcutHandlers = Readonly<{
  /** Drafts, dialogs and in-flight requests suspend every shortcut. */
  blocked: boolean;
  onMove: (step: 1 | -1) => void;
  onReply?: () => void;
  onNote?: () => void;
  onEdit?: () => void;
  onCloseTicket?: () => void;
  onBack?: () => void;
  onExpand?: () => void;
}>;

/**
 * Single-key triage shortcuts for the Tickets tab: J/K move through the queue, R replies, N adds
 * a note, E edits, C closes, F expands or collapses the open ticket and Escape returns to the
 * queue. Typing, modifiers and open dialogs always take precedence; a row's
 * checkbox does not, so selecting tickets keeps the shortcuts.
 * The listener is removed while the tab is hidden because retained tabs unmount their effects.
 */
export function useSdpTicketShortcuts(handlers: SdpTicketShortcutHandlers): void {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (
      handlers.blocked ||
      event.defaultPrevented ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      isAnyModalOpen() ||
      (event.target instanceof HTMLElement &&
        (event.target.matches(
          'textarea, select, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"])',
        ) ||
          event.target.isContentEditable ||
          event.target.closest('[contenteditable="true"]') !== null))
    )
      return;
    const key = event.key.toLowerCase();
    if (key === 'j' || key === 'k') {
      event.preventDefault();
      handlers.onMove(key === 'j' ? 1 : -1);
      return;
    }
    const letters: Record<string, (() => void) | undefined> = {
      r: handlers.onReply,
      n: handlers.onNote,
      e: handlers.onEdit,
      c: handlers.onCloseTicket,
      f: handlers.onExpand,
    };
    const action = event.key === 'Escape' ? handlers.onBack : !event.shiftKey && letters[key];
    if (!action) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, []);
}
