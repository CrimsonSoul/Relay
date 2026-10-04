import { useEffect, useState } from 'react';
import type { PendingSyncStatus } from '@shared/ipc';

export function usePendingSyncStatus(): PendingSyncStatus {
  const [status, setStatus] = useState<PendingSyncStatus>({ pendingCount: 0 });

  useEffect(() => {
    let active = true;
    // A pushed status is always newer than the initial read; never let a slow
    // read overwrite it.
    let pushed = false;
    void globalThis.api
      ?.getPendingSyncStatus?.()
      .then((status) => {
        if (active && !pushed) setStatus(status);
      })
      .catch(() => undefined);
    const unsubscribe = globalThis.api?.onPendingSyncStatusChanged?.((status) => {
      pushed = true;
      setStatus(status);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return status;
}
