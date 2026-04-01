import { useState, useEffect } from 'react';
import {
  initPocketBase,
  authenticate,
  onConnectionStateChange,
  stopHealthCheck,
  AUTH_TIMEOUT_MS,
  type ConnectionState,
} from '../services/pocketbase';

/**
 * Overall connection timeout — generous enough to allow both sequential auth
 * attempts to timeout via AbortController, plus a small buffer.
 */
export const CONNECTION_TIMEOUT_MS = AUTH_TIMEOUT_MS * 2 + 5_000;

export function usePocketBase(url: string | null, secret: string | null) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !secret) return;

    initPocketBase(url);

    const unsubscribe = onConnectionStateChange(setState);

    // Safety-net timeout: if authenticate() hangs beyond all per-attempt
    // timeouts (e.g. due to a bug or an unexpected code path), surface an
    // error so the user isn't stuck on an infinite spinner.
    const timeoutId = setTimeout(() => {
      setError('Connection timed out. The server may be unreachable.');
    }, CONNECTION_TIMEOUT_MS);

    void authenticate(secret).then((ok) => {
      clearTimeout(timeoutId);
      if (!ok) {
        setError('Authentication failed. Check your passphrase.');
      }
    });

    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
      stopHealthCheck();
    };
  }, [url, secret]);

  return { connectionState: state, error };
}
