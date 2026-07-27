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

  // Focus first focusable element on mount
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const focusableElements = focusableWithin(containerRef.current);
    if (focusableElements.length === 0) return;
    // Small delay to ensure modal content is rendered. Cancelled on teardown so
    // a modal closed within the same frame cannot steal focus back afterwards.
    const frame = requestAnimationFrame(() => focusableElements[0]!.focus());
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
      const lastElement = focusableElements[focusableElements.length - 1]!;

      // Shift+Tab on first element -> go to last
      if (e.shiftKey && document.activeElement === (firstElement as Element)) {
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
