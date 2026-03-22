import { useState, useEffect } from 'react';
import {
  initPocketBase,
  authenticate,
  onConnectionStateChange,
  stopHealthCheck,
  type ConnectionState,
} from '../services/pocketbase';

export function usePocketBase(url: string | null, secret: string | null) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url || !secret) return;

    initPocketBase(url);

    const unsubscribe = onConnectionStateChange(setState);

    void authenticate(secret).then((ok) => {
      if (!ok) {
        setError('Authentication failed. Check your passphrase.');
      }
    });

    return () => {
      unsubscribe();
      stopHealthCheck();
    };
  }, [url, secret]);

  return { connectionState: state, error };
}
