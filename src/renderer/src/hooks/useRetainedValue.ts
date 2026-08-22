import { useRef } from 'react';

/** Retains the last identity-bearing value while an exit transition completes. */
export function useRetainedValue<T>(value: T | null | undefined): T | null {
  const retained = useRef<T | null>(value ?? null);

  if (value !== null && value !== undefined) retained.current = value;

  return retained.current;
}
