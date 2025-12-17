import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement = HTMLElement>(isActive: boolean = true) {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Store the previously focused element when trap activates
  useEffect(() => {
    if (isActive) {
      previousActiveElement.current = document.activeElement;
    }
  }, [isActive]);

  // Restore focus when trap deactivates
  useEffect(() => {
    return () => {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  // Focus first focusable element on mount
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length > 0) {
      // Small delay to ensure modal content is rendered
      requestAnimationFrame(() => {
        focusableElements[0].focus();
      });
    }
  }, [isActive]);

  // Handle Tab key to trap focus
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive || !containerRef.current) return;
    if (e.key !== 'Tab') return;

    const focusableElements = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Shift+Tab on first element -> go to last
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
      return;
    }

    // Tab on last element -> go to first
    if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
      return;
    }

    // If focus is outside the container, bring it back
    if (!containerRef.current.contains(document.activeElement)) {
      e.preventDefault();
      firstElement.focus();
    }
  }, [isActive]);

  // Attach keydown listener
  useEffect(() => {
    if (!isActive) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);

  return containerRef;
}
