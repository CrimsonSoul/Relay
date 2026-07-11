import { useState, useEffect } from 'react';
import type { PbAuthSession } from '@shared/ipc';
import {
  initPocketBase,
  loadAuthSession,
  onConnectionStateChange,
  startOfflineMode,
  stopHealthCheck,
  type ConnectionState,
} from '../services/pocketbase';

export function usePocketBase(url: string | null, auth: PbAuthSession | null, offlineMode = false) {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!url) {
      setState('connecting');
      return;
    }

    setState('connecting');
    initPocketBase(url);

    const unsubscribe = onConnectionStateChange(setState);
    if (offlineMode) startOfflineMode();

    return () => {
      unsubscribe();
      stopHealthCheck();
      setState('connecting');
    };
  }, [url, offlineMode]);

  useEffect(() => {
    if (!url || !auth) return;

    loadAuthSession(auth);
  }, [url, auth]);

  return { connectionState: state };
}
