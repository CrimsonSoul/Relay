import { useCallback, useEffect, useState } from 'react';
import type { KnowledgePendingUploadTransfer } from '@shared/ipc';
import { TactileButton } from '../../components/TactileButton';

type PendingTransfer = KnowledgePendingUploadTransfer;

export function WebUploadRecovery({
  uploading,
  onRecovered,
}: Readonly<{ uploading: boolean; onRecovered: () => void | Promise<void> }>) {
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const refresh = useCallback(async () => {
    try {
      // Only the Relay Web bridge stages resumable transfers; without it there is nothing to recover.
      const getPending = globalThis.api?.getPendingKnowledgeUploadTransfer;
      setPending(getPending ? await getPending() : null);
      setError(null);
    } catch {
      setError('Could not check for interrupted transfers. Reconnect, then retry.');
    }
  }, []);
  useEffect(() => {
    if (uploading) return;
    void refresh();
    globalThis.addEventListener('focus', refresh);
    return () => globalThis.removeEventListener('focus', refresh);
  }, [refresh, uploading]);

  const recover = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const recovered = await globalThis.api?.reselectKnowledgeUploadSource(pending.batchId);
      // Even an interrupted restart can replace the original staging batch.
      await refresh();
      if (!recovered) {
        setError(
          'Select all original PDFs with matching names and sizes. The transfer restarts from the beginning; cancelled selection leaves it unchanged.',
        );
        return;
      }
      await onRecovered();
    } catch {
      await refresh();
      setError('Transfer could not restart. Reconnect and reselect the PDFs again.');
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const discarded = await globalThis.api?.discardPendingKnowledgeUploadTransfer?.(
        pending.batchId,
      );
      if (!discarded) throw new Error('unavailable');
      setConfirmDiscard(false);
      await refresh();
    } catch {
      setError('Could not discard the transfer. Reconnect and retry.');
    } finally {
      setBusy(false);
    }
  };
  if (uploading || (!pending && !error)) return null;
  return (
    <section className="knowledge-management__recovery" aria-label="Interrupted PDF transfer">
      {pending && (
        <>
          <strong>PDF transfer needs attention</strong>
          <p>
            Reselect these PDFs to restart the transfer in this session:{' '}
            {pending.files.map((file) => file.name).join(', ')}. Uploaded documents are unaffected.
            Recovery ends when you sign out or the server restarts.
          </p>
          <TactileButton size="sm" disabled={busy} onClick={() => void recover()}>
            {busy ? 'Working…' : 'Reselect PDFs'}
          </TactileButton>
          <TactileButton size="sm" disabled={busy} onClick={() => setConfirmDiscard(true)}>
            Discard Transfer
          </TactileButton>
          {confirmDiscard && (
            <p>
              Discard these unfinished bytes?{' '}
              <button type="button" disabled={busy} onClick={() => void discard()}>
                Confirm Discard
              </button>{' '}
              <button type="button" onClick={() => setConfirmDiscard(false)}>
                Keep Transfer
              </button>
            </p>
          )}
        </>
      )}
      {error && (
        <div className="panel-error ink-rail ink-rail--alarm" role="alert">
          <span>{error}</span>
          <TactileButton size="sm" disabled={busy} onClick={() => void refresh()}>
            Retry Transfer Check
          </TactileButton>
        </div>
      )}
    </section>
  );
}
