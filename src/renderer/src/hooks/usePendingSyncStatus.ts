import { useEffect, useState } from 'react';
import type { PendingSyncStatus } from '@shared/ipc';

export function usePendingSyncStatus(): PendingSyncStatus {
  const [status, setStatus] = useState<PendingSyncStatus>({ pendingCount: 0 });

  useEffect(() => {
    let active = true;
    void globalThis.api
      ?.getPendingSyncStatus?.()
      .then((status) => {
        if (active) setStatus(status);
      })
      .catch(() => undefined);
    const unsubscribe = globalThis.api?.onPendingSyncStatusChanged?.((status) => {
      setStatus(status);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return status;
}
