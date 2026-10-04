import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Elements the browser will actually focus. Disabled and hidden controls match
 * a plain selector but can never become document.activeElement — treating one
 * as the cycle boundary silently broke the trap, letting Tab escape the dialog,
 * and a disabled first match made the initial focus() call a no-op.
 */
function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hidden && !element.closest('[hidden],[aria-hidden="true"],[inert]'),
  );
}

type FocusTrapOptions = Readonly<{
  restoreOnDeactivate?: boolean;
  restoreWhen?: boolean;
}>;

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  isActive: boolean = true,
  { restoreOnDeactivate = true, restoreWhen = false }: FocusTrapOptions = {},
) {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const focusRestored = useRef(false);

  // Store/restore focus as the trap toggles, not only on mount/unmount.
  useEffect(() => {
    if (isActive) {
      if (previousActiveElement.current === null || focusRestored.current) {
        previousActiveElement.current = document.activeElement;
      }
      focusRestored.current = false;
      return;
    }

    const shouldRestore = restoreWhen || (restoreOnDeactivate && !isActive);
    if (
      shouldRestore &&
      !focusRestored.current &&
      previousActiveElement.current instanceof HTMLElement
    ) {
      previousActiveElement.current.focus();
      focusRestored.current = true;
    }
  }, [isActive, restoreOnDeactivate, restoreWhen]);

  // Fallback restoration for true unmount cases.
  useEffect(() => {
    return () => {
      if (!focusRestored.current && previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  // Initial focus lands where the work is: a control that asked for it, then the first
  // editable field, then the enabled primary action. Destructive (danger) actions are never
  // chosen, so Enter cannot confirm a deletion the operator has not reached deliberately.
  // Otherwise a container that opted in with tabindex="-1" takes focus itself (WAI-ARIA dialog
  // practice), so the header close button's tooltip is not shown on a programmatic focus; a
  // container without it falls back to its first focusable element.
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const container = containerRef.current;

    // Small delay to ensure modal content is rendered. Cancelled on teardown so
    // a modal closed within the same frame cannot steal focus back afterwards.
    const frame = requestAnimationFrame(() => {
      if (container.contains(document.activeElement) && document.activeElement !== container) {
        return;
      }
      const focusableElements = focusableWithin(container);
      const containerFocusable = container.getAttribute('tabindex') === '-1';
      const target =
        focusableElements.find((element) => element.matches('[data-autofocus]')) ??
        focusableElements.find(
          (element) =>
            element.matches(
              'textarea, select, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="hidden"])',
            ) && !(element as HTMLInputElement).readOnly,
        ) ??
        focusableElements.find((element) => element.matches('.tactile-button--primary')) ??
        (containerFocusable ? container : focusableElements[0]);
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive]);

  // Handle Tab key to trap focus
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive || !containerRef.current) return;
      if (e.key !== 'Tab') return;

      const focusableElements = focusableWithin(containerRef.current);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0]!;
      const lastElement = focusableElements.at(-1)!;

      // Shift+Tab on the first element, or on the container itself -> go to last
      const atStart =
        document.activeElement === (firstElement as Element) ||
        document.activeElement === containerRef.current;
      if (e.shiftKey && atStart) {
        e.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab on last element -> go to first
      if (!e.shiftKey && document.activeElement === (lastElement as Element)) {
        e.preventDefault();
        firstElement.focus();
        return;
      }

      // If focus is outside the container, bring it back
      if (!containerRef.current.contains(document.activeElement)) {
        e.preventDefault();
        firstElement.focus();
      }
    },
    [isActive],
  );

  // Attach keydown listener
  useEffect(() => {
    if (!isActive) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);

  return containerRef;
}
