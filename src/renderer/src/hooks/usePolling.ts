import { useEffect, useRef } from 'react';

/**
 * Runs a callback on a fixed interval, automatically handling cleanup
 * and stale closure prevention via ref.
 */
export function usePolling(callback: () => void, intervalMs: number): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
