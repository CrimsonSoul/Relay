import { useEffect, useEffectEvent } from 'react';
import { isAnyModalOpen } from '../../components/modalStack';

type AlertShortcutHandlers = Readonly<{
  /** An export in flight or an open dialog suspends both shortcuts. */
  blocked: boolean;
  onSaveImage: () => void;
  onOpenDraft: () => void;
}>;

/**
 * Export shortcuts for the Alerts tab: Mod+S saves the image and Mod+Enter opens the
 * Outlook (or EML) draft. They fire from inside the subject and body fields on purpose,
 * because finishing the text is when the operator wants to send. The listener lives
 * only while the tab is mounted, so other tabs keep their own Mod+S/Mod+Enter meaning.
 */
export function useAlertShortcuts(handlers: AlertShortcutHandlers): void {
  const handle = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (!event.metaKey && !event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key !== 's' && key !== 'enter') return;
    // Always claim Mod+S so the browser "save page" dialog never opens over the tab.
    event.preventDefault();
    if (handlers.blocked || isAnyModalOpen()) return;
    if (key === 's') handlers.onSaveImage();
    else handlers.onOpenDraft();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle(event);
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, []);
}
