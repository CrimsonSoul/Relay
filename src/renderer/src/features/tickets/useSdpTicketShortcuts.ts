import { useEffect, useEffectEvent } from 'react';
import { isAnyModalOpen } from '../../components/modalStack';

export type SdpTicketShortcutHandlers = Readonly<{
  /** Drafts, dialogs and in-flight requests suspend every shortcut. */
  blocked: boolean;
  onMove: (step: 1 | -1) => void;
  onReply?: () => void;
  onBack?: () => void;
}>;

/**
 * Single-key triage shortcuts for the Tickets tab: J/K move through the queue, R replies and
 * Escape returns to the queue. Typing, modifiers and open dialogs always take precedence; a row's
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
    } else if (key === 'r' && !event.shiftKey && handlers.onReply) {
      event.preventDefault();
      handlers.onReply();
    } else if (event.key === 'Escape' && handlers.onBack) {
      event.preventDefault();
      handlers.onBack();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, []);
}
