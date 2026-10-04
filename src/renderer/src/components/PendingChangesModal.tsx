import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

// The draft keeps the raw text while the field is edited: an emptied field or a lone "-" has no
// numeric value, and rendering the last committed number would overwrite what is being typed.
function NumberField({
  name,
  value,
  disabled,
  onEdit,
}: Readonly<{
  name: string;
  value: unknown;
  disabled: boolean;
  onEdit: (key: string, value: Scalar) => void;
}>) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      aria-label={`Local ${name}`}
      type="number"
      value={draft ?? String(Number(value))}
      disabled={disabled}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next)) onEdit(name, next);
      }}
      onBlur={() => setDraft(null)}
    />
  );
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
  if (typeof original === 'number')
    return <NumberField name={name} value={value} disabled={disabled} onEdit={onEdit} />;
  return (
    <Input
      aria-label={`Local ${name}`}
      type="text"
      value={String(value)}
      disabled={disabled}
      onChange={(event) => onEdit(name, event.target.value)}
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
  const closeReview = () => {
    setReview(null);
    setConfirmDiscard(false);
  };
  let footer: ReactNode;
  if (!review) {
    footer = (
      <>
        <span className="pending-footer-hint">
          Retries every queued change at its saved revision.
        </span>
        <TactileButton
          variant="primary"
          disabled={busy || !online || !entries.length}
          onClick={() => void retry()}
        >
          Retry All
        </TactileButton>
      </>
    );
  } else if (confirmDiscard) {
    footer = (
      <fieldset className="pending-confirm" aria-label="Confirm discard">
        <p>
          Discard the local {review.entry.action} for {review.entry.label}? This cannot be undone.
        </p>
        <TactileButton size="sm" disabled={busy} onClick={() => setConfirmDiscard(false)}>
          Keep Local Change
        </TactileButton>
        <TactileButton
          variant="danger"
          disabled={busy || !online}
          onClick={() => void resolve('server')}
        >
          Discard Local Change
        </TactileButton>
      </fieldset>
    );
  } else {
    footer = (
      <>
        <TactileButton
          size="sm"
          disabled={busy || !online}
          onClick={() => void inspect(review.entry.id)}
        >
          Refresh Server Values
        </TactileButton>
        <TactileButton
          size="sm"
          disabled={busy || !online || !review.token}
          onClick={() => setConfirmDiscard(true)}
        >
          Use Server Version
        </TactileButton>
        <TactileButton
          variant="primary"
          disabled={busy || !online || review.serverState !== 'present' || !review.token}
          onClick={() => void resolve('retry')}
        >
          Retry Now
        </TactileButton>
      </>
    );
  }
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Pending changes"
      subtitle="Compare your saved local changes with the server before resolving a conflict."
      variant="wide"
      dismissible={!busy}
      bodyClassName="pending-changes"
      footer={footer}
    >
      {(!online || message || busy || (!loaded && !message)) && (
        <div className="pending-status">
          {!online && (
            <output>
              Offline. You can inspect saved changes; reconnect to compare server values or retry.
            </output>
          )}
          {message && <output>{message}</output>}
          {busy && <output>Working…</output>}
          {!loaded && !message && <output>Loading pending changes…</output>}
        </div>
      )}
      {review ? (
        <section className="pending-review" aria-labelledby="pending-review-title">
          <header className="pending-review-header">
            <TactileButton size="sm" disabled={busy} onClick={closeReview}>
              Back to Pending Changes
            </TactileButton>
            <h3 id="pending-review-title">{review.entry.label}</h3>
            <p className="pending-review-meta">
              {review.entry.collection} · {review.entry.action} · {review.entry.recordId}
            </p>
            <p>{review.entry.reason}</p>
          </header>
          {review.serverState === 'unavailable' ? (
            <p className="panel-error ink-rail ink-rail--alarm" role="alert">
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
          <p className="pending-review-meta">
            Structured values are read-only. Retry preserves their saved local values.
          </p>
        </section>
      ) : (
        <>
          {loaded && !entries.length && <p>No pending changes.</p>}
          <ul className="pending-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  className="pending-entry"
                  type="button"
                  disabled={busy}
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
            <TactileButton
              size="sm"
              disabled={busy}
              onClick={() => void act(() => load(nextAfterId))}
            >
              Load More Changes
            </TactileButton>
          )}
        </>
      )}
    </Modal>
  );
}
