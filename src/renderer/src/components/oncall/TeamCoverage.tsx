import { useEffect, useState } from 'react';
import type { OnCallRow } from '@shared/ipc';
import { useCollection } from '../../hooks/useCollection';
import { isOnline, onConnectionStateChange } from '../../services/pocketbase';
import {
  calendarDate,
  confirmCoverage,
  coverageState,
  COVERAGE_COLLECTION,
  COVERAGE_UNAVAILABLE,
  type CoverageReview,
} from '../../services/oncallCoverageService';
import { lastEditedLabel } from '../../utils/oncallFreshness';
import { Modal } from '../Modal';
import { Input } from '../Input';
import { TactileButton } from '../TactileButton';

export function TeamCoverage({
  teamId,
  rows,
  locked,
}: Readonly<{
  teamId: string;
  rows: OnCallRow[];
  locked: boolean;
}>) {
  const reviews = useCollection<CoverageReview>(COVERAGE_COLLECTION);
  const [online, setOnline] = useState(isOnline);
  const [pending, setPending] = useState<number | null>(null);
  const [saved, setSaved] = useState<CoverageReview | null>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(calendarDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => onConnectionStateChange((state) => setOnline(state === 'online')), []);
  useEffect(() => {
    if (globalThis.api?.runtime?.kind === 'web') {
      setPending(0);
      return;
    }
    let active = true;
    let receivedEvent = false;
    void globalThis.api
      ?.getPendingSyncStatus?.()
      .then((status) => {
        if (active && !receivedEvent) setPending(status.pendingCount);
      })
      .catch(() => {
        if (active && !receivedEvent) setPending(null);
      });
    const unsubscribe = globalThis.api?.onPendingSyncStatusChanged?.((status) => {
      receivedEvent = true;
      setPending(status.pendingCount);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => setSaved(null), [reviews.data]);
  const persisted = reviews.data.find((review) => review.teamId === teamId);
  const review =
    saved && (!persisted || (saved.updated ?? '') > (persisted.updated ?? '')) ? saved : persisted;
  const state = coverageState(review, rows);
  const queued = rows.some((row) => row.queuedAt) || (pending ?? 0) > 0;
  const available = reviews.hasLoadedSnapshot && !reviews.loading && !reviews.error;
  const disabled = locked || !online || queued || pending === null || !available || saving;
  let label = 'Not confirmed';
  if (state === 'needs-review') label = 'Needs review';
  if (state === 'confirmed') label = `Confirmed through ${review?.validThrough}`;
  if (pending === null) label = 'Checking pending changes';
  if (!online) label = 'Offline — coverage unverified';
  if (queued) label = 'Pending changes';
  if (!available) label = reviews.error ? 'Confirmation unavailable' : 'Checking coverage';
  const save = async () => {
    if (disabled) return;
    setSaving(true);
    setError('');
    try {
      const confirmed = await confirmCoverage({ teamId, validThrough: date }, rows);
      setSaved(confirmed);
      setOpen(false);
      void reviews.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm coverage. Try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="team-coverage">
      <div className="team-coverage-state" aria-live="polite">
        <span>Last edited {lastEditedLabel(rows)}</span>
        <span>{label}</span>
      </div>
      <TactileButton
        variant="secondary"
        title={locked ? 'Unlock board to confirm coverage' : undefined}
        disabled={disabled}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        Confirm coverage
      </TactileButton>
      {queued && <p>Sync pending changes before confirming coverage.</p>}
      {reviews.error && <p>{COVERAGE_UNAVAILABLE}</p>}
      <Modal
        isOpen={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        title="Confirm coverage"
        variant="standard"
        footer={
          <>
            <TactileButton variant="secondary" disabled={saving} onClick={() => setOpen(false)}>
              Cancel
            </TactileButton>
            <TactileButton
              variant="primary"
              disabled={disabled || !date}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save confirmation'}
            </TactileButton>
          </>
        }
      >
        <div className="modal-form-body">
          <p>Confirm that this team's listed coverage is correct through the selected date.</p>
          <Input
            label="Confirmed through"
            type="date"
            min={calendarDate()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
