import { useEffect, useEffectEvent, type RefObject } from 'react';

/**
 * Closes an open ticket popover on a press outside it and its trigger, or on one of `keys` inside
 * it. Keys are caught in the capture phase so this popover answers before a dialog, focus trap or
 * ticket shortcut, and `onDismiss(true)` asks the caller to return focus to the trigger.
 */
export function usePopoverDismiss(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  keys: readonly string[],
  onDismiss: (restoreFocus: boolean) => void,
): void {
  const dismiss = useEffectEvent(onDismiss);
  const closesOn = useEffectEvent((key: string) => keys.includes(key));
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      dismiss(false);
    };
    const key = (event: KeyboardEvent) => {
      if (!closesOn(event.key) || !panel.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, panel, trigger]);
}
