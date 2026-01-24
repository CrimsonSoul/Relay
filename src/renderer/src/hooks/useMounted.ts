import { useEffect, useRef } from 'react';

/**
 * Hook to track if a component is still mounted.
 * Useful for preventing state updates on unmounted components after async operations.
 */
export function useMounted() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}
