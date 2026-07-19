import { useEffect, useRef, useState } from 'react';

export type PresenceState = 'opening' | 'open' | 'closing';

export type PresenceSnapshot = Readonly<{
  isMounted: boolean;
  state: PresenceState;
}>;

export const DEFAULT_LAYER_EXIT_MS = 160;

export function usePresence(
  isPresent: boolean,
  exitDurationMs: number = DEFAULT_LAYER_EXIT_MS,
): PresenceSnapshot {
  const [isMounted, setIsMounted] = useState(isPresent);
  const [phase, setPhase] = useState<Extract<PresenceState, 'opening' | 'open'>>('opening');
  const mountedRef = useRef(isPresent);

  useEffect(() => {
    let frame = 0;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;

    if (isPresent) {
      mountedRef.current = true;
      setIsMounted(true);
      setPhase('opening');
      frame = globalThis.requestAnimationFrame(() => setPhase('open'));
    } else if (mountedRef.current) {
      exitTimer = globalThis.setTimeout(() => {
        mountedRef.current = false;
        setIsMounted(false);
      }, exitDurationMs);
    }

    return () => {
      if (frame) globalThis.cancelAnimationFrame(frame);
      if (exitTimer) globalThis.clearTimeout(exitTimer);
    };
  }, [exitDurationMs, isPresent]);

  return {
    isMounted,
    state: isPresent ? phase : 'closing',
  };
}
