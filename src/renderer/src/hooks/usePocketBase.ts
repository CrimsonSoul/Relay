import { useState, useEffect } from 'react';
import type { PbAuthSession } from '@shared/ipc';
import {
  initPocketBase,
  loadAuthSession,
  onConnectionStateChange,
  stopHealthCheck,
  type ConnectionState,
} from '../services/pocketbase';

export function usePocketBase(url: string | null, auth: PbAuthSession | null) {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!url) {
      setState('connecting');
      return;
    }

    setState('connecting');
    initPocketBase(url);

    const unsubscribe = onConnectionStateChange(setState);

    return () => {
      unsubscribe();
      stopHealthCheck();
      setState('connecting');
    };
  }, [url]);

  useEffect(() => {
    if (!url || !auth) return;

    loadAuthSession(auth);
  }, [url, auth]);

  return { connectionState: state };
}
