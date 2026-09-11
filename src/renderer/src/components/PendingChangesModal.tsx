import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingChangeReview, PendingChangeSummary, PendingChangesRequest } from '@shared/ipc';
import { Modal } from './Modal';
import { Input } from './Input';
import { TactileButton } from './TactileButton';
import { refreshStoresAfterPendingSync } from '../stores/collectionStoreRegistry';
import './pendingChanges.css';

const metadata = new Set([
  'id',
  'created',
  'updated',
  'queuedAt',
  'collectionId',
  'collectionName',
  'expand',
]);
type Scalar = string | number | boolean;
function displayValue(value: unknown): string | undefined {
  if (value === undefined) return 'Not set';
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value);
}

function LocalField({
  name,
  original,
  value,
  editable,
  disabled,
  onEdit,
}: Readonly<{
  name: string;
  original: unknown;
  value: unknown;
  editable: boolean;
  disabled: boolean;
  onEdit: (key: string, value: Scalar) => void;
}>) {
  if (!editable) return <span className="pending-value">{displayValue(original)}</span>;
  if (typeof original === 'boolean')
    return (
      <label className="pending-checkbox">
        <input
          type="checkbox"
          aria-label={`Local ${name}`}
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onEdit(name, event.target.checked)}
        />
        {value ? 'Yes' : 'No'}
      </label>
    );
  return (
    <Input
      aria-label={`Local ${name}`}
      type={typeof original === 'number' ? 'number' : 'text'}
      value={String(value)}
      disabled={disabled}
      onChange={(event) => {
        const next = typeof original === 'number' ? event.target.valueAsNumber : event.target.value;
        if (typeof next !== 'number' || Number.isFinite(next)) onEdit(name, next);
      }}
    />
  );
}

function retryMessage(remaining: number, hasErrors: boolean): string {
  if (remaining > 0) {
    const noun = remaining === 1 ? 'change remains' : 'changes remain';
    return `${remaining} ${noun} queued. Review the pending changes below.`;
  }
  return hasErrors
    ? 'Sync could not complete. Review the pending changes below.'
    : 'Saved changes synced.';
}

function ReviewFields({
  review,
  edits,
  onEdit,
  disabled,
}: Readonly<{
  review: PendingChangeReview;
  edits: Record<string, Scalar>;
  onEdit: (key: string, value: Scalar) => void;
  disabled: boolean;
}>) {
  const fields = [
    ...new Set([...Object.keys(review.local), ...Object.keys(review.server ?? {})]),
  ].filter((key) => !metadata.has(key));
  return (
    <section className="pending-fields" aria-label="Local and server values">
      <table>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Local change</th>
            <th scope="col">Current server</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((key) => {
            const original = review.local[key];
            const value = edits[key] ?? original;
            const editable =
              review.entry.action !== 'delete' &&
              ['string', 'number', 'boolean'].includes(typeof original);
            return (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>
                  <LocalField
                    name={key}
                    original={original}
                    value={value}
                    editable={editable}
                    disabled={disabled}
                    onEdit={onEdit}
                  />
                </td>
                <td>
                  <span className="pending-value">{displayValue(review.server?.[key])}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function PendingChangesModal({
  online,
  onClose,
}: Readonly<{ online: boolean; onClose: () => void }>) {
  const [entries, setEntries] = useState<PendingChangeSummary[]>([]);
  const [nextAfterId, setNextAfterId] = useState<number>();
  const [review, setReview] = useState<PendingChangeReview | null>(null);
  const [edits, setEdits] = useState<Record<string, Scalar>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const request = useCallback(async (input: PendingChangesRequest) => {
    const result = await globalThis.api?.pendingChanges?.(input);
    if (!result) throw new Error('Pending changes are unavailable in this window.');
    if (!result.ok) throw new Error(result.error);
    return result;
  }, []);
  const load = useCallback(
    async (afterId?: number) => {
      const result = await request({
        action: 'list',
        ...(afterId === undefined ? {} : { afterId }),
      });
      if (!mounted.current || !('entries' in result)) return;
      setEntries((previous) =>
        afterId === undefined ? result.entries : [...previous, ...result.entries],
      );
      setNextAfterId(result.nextAfterId);
      setLoaded(true);
    },
    [request],
  );
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error
            ? error.message
            : 'Unable to complete this action. Your change remains queued.',
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load().catch(() => {
      if (mounted.current)
        setMessage('Could not load pending changes. Close this dialog and try again.');
    });
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const inspect = (id: number) =>
    act(async () => {
      const result = await request({ action: 'review', id });
      if (mounted.current && 'review' in result) {
        setReview(result.review);
        setEdits({});
        setConfirmDiscard(false);
      }
    });
  const resolve = (resolution: 'server' | 'retry') =>
    act(async () => {
      if (!review?.token) return;
      const result = await request({
        action: 'resolve',
        token: review.token,
        resolution,
        ...(resolution === 'retry' ? { edits } : {}),
      });
      if ('resolved' in result) await refreshStoresAfterPendingSync(result.remainingChanges);
      if (!mounted.current) return;
      setReview(null);
      setConfirmDiscard(false);
      await load();
      setMessage(
        'resolved' in result && !result.resolved
          ? 'The change remains queued. Review it again to see the latest server values.'
          : 'Change resolved.',
      );
    });
  const retry = () =>
    act(async () => {
      const result = await globalThis.api?.syncPending();
      if (!result) throw new Error('Sync is unavailable in this window.');
      await refreshStoresAfterPendingSync(result.remainingChanges ?? []);
      if (!mounted.current) return;
      setReview(null);
      await load();
      const remaining = result.remaining ?? 0;
      setMessage(retryMessage(remaining, result.errors.length > 0));
    });
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Pending changes"
      variant="wide"
      dismissible={!busy}
      bodyClassName="pending-changes"
    >
      <p>Compare your saved local changes with the server before resolving a conflict.</p>
      {!online && (
        <output>
          Reconnect to review server values or retry. Your local changes are retained.
        </output>
      )}
      {message && <output>{message}</output>}
      {busy && <output>Working…</output>}
      {review ? (
        <>
          <TactileButton
            size="sm"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setConfirmDiscard(false);
            }}
          >
            Back to pending changes
          </TactileButton>
          <h3>{review.entry.label}</h3>
          <p>
            {review.entry.collection} · {review.entry.action} · {review.entry.recordId}
          </p>
          <p>{review.entry.reason}</p>
          {review.serverState === 'unavailable' ? (
            <p role="alert">
              Current server values are unavailable. Check the connection and review again.
            </p>
          ) : null}
          {review.serverState === 'deleted' && (
            <p>
              This record does not exist on the server. Discarding your local change will remove it
              locally.
            </p>
          )}
          <ReviewFields
            review={review}
            edits={edits}
            onEdit={(key, value) => setEdits((previous) => ({ ...previous, [key]: value }))}
            disabled={busy || !online || review.serverState !== 'present'}
          />
          <p>Structured values are read-only. Retry preserves their saved local values.</p>
          {confirmDiscard ? (
            <fieldset className="pending-actions pending-confirm" aria-label="Confirm discard">
              <p>
                Discard the local {review.entry.action} for {review.entry.label}? This cannot be
                undone.
              </p>
              <TactileButton
                variant="danger"
                disabled={busy || !online}
                onClick={() => void resolve('server')}
              >
                Discard local change
              </TactileButton>
              <TactileButton disabled={busy} onClick={() => setConfirmDiscard(false)}>
                Keep local change
              </TactileButton>
            </fieldset>
          ) : (
            <div className="pending-actions">
              <TactileButton
                disabled={busy || !online || !review.token}
                onClick={() => setConfirmDiscard(true)}
              >
                Use server version
              </TactileButton>
              <TactileButton
                variant="primary"
                disabled={busy || !online || review.serverState !== 'present' || !review.token}
                onClick={() => void resolve('retry')}
              >
                Review and retry
              </TactileButton>
              <TactileButton
                disabled={busy || !online}
                onClick={() => void inspect(review.entry.id)}
              >
                Refresh server values
              </TactileButton>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="pending-actions">
            <TactileButton
              disabled={busy || !online || !entries.length}
              onClick={() => void retry()}
            >
              Retry saved change
            </TactileButton>
            <span>Retries all pending changes against their saved revisions.</span>
          </div>
          {!loaded && !message && <output>Loading pending changes…</output>}
          {loaded && !entries.length && <p>No pending changes.</p>}
          <ul className="pending-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  className="pending-entry"
                  type="button"
                  disabled={busy || !online}
                  onClick={() => void inspect(entry.id)}
                >
                  <strong>{entry.label}</strong>
                  <span>
                    {entry.collection} · {entry.action}
                  </span>
                  <span>{entry.reason}</span>
                </button>
              </li>
            ))}
          </ul>
          {nextAfterId !== undefined && (
            <TactileButton disabled={busy} onClick={() => void act(() => load(nextAfterId))}>
              Load more changes
            </TactileButton>
          )}
        </>
      )}
    </Modal>
  );
}
