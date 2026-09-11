import { useCallback, useRef, useState } from 'react';
import { pickBrowserFile } from '../services/browserFilePicker';
import {
  prepareServerSync,
  type ServerSyncPlan,
  type ServerSyncProgress,
  type ServerSyncResult,
} from '../services/serverSyncService';
import { useMounted } from './useMounted';

export function useServerSyncImport() {
  const [preview, setPreview] = useState<ServerSyncPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ServerSyncProgress | null>(null);
  const [result, setResult] = useState<ServerSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useMounted();
  const reset = useCallback(() => {
    if (busyRef.current) return;
    setPreview(null);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);
  const chooseFile = useCallback(async () => {
    if (busyRef.current) return;
    reset();
    busyRef.current = true;
    setBusy(true);
    try {
      const file = await pickBrowserFile({
        accept: '.json,.csv,.xlsx',
        maxBytes: 25 * 1024 * 1024,
      });
      if (file.kind === 'cancelled') return;
      const plan = await prepareServerSync(file);
      if (mounted.current) setPreview(plan);
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'Could not preview this file.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [mounted, reset]);
  const apply = useCallback(async () => {
    if (busyRef.current || !preview) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await preview.apply((nextProgress) => {
        if (mounted.current) setProgress(nextProgress);
      });
      if (mounted.current) setResult(next);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Server sync failed.');
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setPreview(null);
        setProgress(null);
        setBusy(false);
      }
    }
  }, [mounted, preview]);
  const downloadBackup = useCallback(() => {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview.backupJson], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relay-servers-before-sync-${new Date().toISOString().replaceAll(':', '-')}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 100);
  }, [preview]);
  return { preview, busy, progress, result, error, chooseFile, apply, reset, downloadBackup };
}
export type ServerSyncController = ReturnType<typeof useServerSyncImport>;
