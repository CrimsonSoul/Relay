import { useCallback, useEffect, useState } from 'react';
import { RELAY_WEB_API_PREFIX, WebKnowledgeUploadStagingBatchSchema } from '@shared/webApi';
import type { z } from 'zod';
import { webSessionClient } from '../../runtime/WebSessionClient';
import { TactileButton } from '../../components/TactileButton';

type PendingTransfer = z.infer<typeof WebKnowledgeUploadStagingBatchSchema>;

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
      const response = await fetch(`${RELAY_WEB_API_PREFIX}/knowledge/upload/pending`, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw new Error('unavailable');
      setPending(WebKnowledgeUploadStagingBatchSchema.nullable().parse(await response.json()));
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
      if (!(await globalThis.api?.reselectKnowledgeUploadSource(pending.batchId))) {
        setError(
          'Select all original PDFs with matching names and sizes. The transfer restarts from the beginning; cancelled selection leaves it unchanged.',
        );
        return;
      }
      await refresh();
      await onRecovered();
    } catch {
      setError('Transfer could not restart. Reconnect and reselect the PDFs again.');
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const session = await webSessionClient.bootstrap();
      if (!session.ok) throw new Error('unavailable');
      const response = await fetch(`${RELAY_WEB_API_PREFIX}/knowledge/upload/abort`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Relay-CSRF': session.session.csrfToken },
        body: JSON.stringify({ batchId: pending.batchId }),
      });
      if (!response.ok) throw new Error('unavailable');
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
            Discard transfer
          </TactileButton>
          {confirmDiscard && (
            <p>
              Discard these unfinished bytes?{' '}
              <button type="button" disabled={busy} onClick={() => void discard()}>
                Confirm discard
              </button>{' '}
              <button type="button" onClick={() => setConfirmDiscard(false)}>
                Keep transfer
              </button>
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            Retry transfer check
          </button>
        </p>
      )}
    </section>
  );
}
