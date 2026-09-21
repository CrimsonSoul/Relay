import { SdpStandardSelect, standardFieldKey } from './SdpStandardSelect';
import { useRef, useState } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import {
  SdpBulkMutationSchema,
  type SdpBulkResult,
  type SdpRequestFields,
  type SdpReview,
} from '@shared/sdpMutation';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
const fields = {
  group: 'Support group',
  technician: 'Technician',
  status: 'Status',
  priority: 'Priority',
  requestType: 'Request type',
  category: 'Category',
  impact: 'Impact',
  urgency: 'Urgency',
  resolution: 'Resolution',
} as const;
const outcomes = {
  confirmed: 'Confirmed by SDP',
  conflict: 'Changed since review — not sent',
  uncertain: 'Not confirmed — check SDP before retrying',
  'not-attempted': 'Not attempted',
};
export function SdpBulkDialog({
  tickets,
  onClose,
  onResult,
}: Readonly<{
  tickets: SdpQueueTicket[];
  onClose: () => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [patch, setPatch] = useState<SdpRequestFields>({});
  const [groupId, setGroupId] = useState<string>();
  const [review, setReview] = useState<SdpReview>();
  const [results, setResults] = useState<SdpBulkResult>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const locked = useRef(false);
  async function submit() {
    if (locked.current || finished) return;
    const parsed = SdpBulkMutationSchema.safeParse({
      kind: 'bulk',
      ids: tickets.map((t) => t.id),
      fields: patch,
    });
    if (!parsed.success) {
      setMessage('Choose at least one change for up to 20 tickets.');
      return;
    }
    const confirming = !!review;
    const command = review
      ? { action: 'confirmChange' as const, confirmationId: review.confirmationId }
      : { action: 'prepareChange' as const, mutation: parsed.data };
    locked.current = true;
    setBusy(true);
    setMessage('');
    if (confirming) {
      setReview(undefined);
      setFinished(true);
    }
    try {
      const result = await globalThis.api!.sdpAccount!(command);
      if (!result.success || !result.data)
        throw new Error('SdpBulkDialog: SDP operation did not return the expected result.');
      if (confirming) {
        setResults(result.data.bulkResult);
        setMessage(result.data.message ?? 'Check each ticket in SDP.');
        onResult(result.data);
      } else if (result.data.review?.mutation.kind === 'bulk') setReview(result.data.review);
      else throw new Error('SdpBulkDialog: SDP operation did not return the expected result.');
    } catch {
      setMessage(
        confirming
          ? 'The result is uncertain. Check all selected tickets in SDP before trying again. Nothing will be retried automatically.'
          : 'Could not prepare these changes. Refresh the queue and check your access.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
    onClose();
  }
  return (
    <Modal
      isOpen
      title="Update selected tickets"
      subtitle={`${tickets.length} tickets · Your work account`}
      width="760px"
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      onClose={close}
      footer={
        <>
          <TactileButton disabled={busy} onClick={close}>
            {finished ? 'Done' : 'Cancel'}
          </TactileButton>
          {!finished && (
            <TactileButton
              variant="primary"
              disabled={busy || (!!review && review.expiresAt <= Date.now())}
              onClick={() => void submit()}
            >
              {review ? `Confirm ${tickets.length} live changes` : 'Review bulk changes'}
            </TactileButton>
          )}
        </>
      }
    >
      <p>
        Each ticket is updated separately. A conflict or unconfirmed result stops the remaining
        changes. SDP may send notifications.
      </p>
      <ul>
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            #{ticket.number} — {ticket.subject}
            {results && (
              <strong>
                {' '}
                · {outcomes[results.find((r) => r.id === ticket.id)?.status ?? 'not-attempted']}
              </strong>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p>
          <output>{message}</output>
        </p>
      )}
      {!finished &&
        (review ? (
          <dl className="ticket-metadata">
            {Object.entries(patch).map(([key, value]) => (
              <div key={key}>
                <dt>{fields[key as keyof typeof fields]}</dt>
                <dd>{value === null ? 'Unassigned' : value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="ticket-form-grid">
            <p>Leave fields blank to keep their existing values. Choose values from SDP.</p>
            {Object.entries(fields).map(([key, label]) => (
              <div key={key}>
                {standardFieldKey(key) ? (
                  <SdpStandardSelect
                    field={standardFieldKey(key)!}
                    label={label}
                    value={patch[key as keyof SdpRequestFields] ?? ''}
                    groupId={groupId}
                    disabled={busy || patch[key as keyof SdpRequestFields] === null}
                    onChange={(value, id) => {
                      if (key === 'group') setGroupId(id);
                      setPatch((current) => {
                        const next = { ...current };
                        if (value) next[key as keyof SdpRequestFields] = value;
                        else delete next[key as keyof SdpRequestFields];
                        if (key === 'group') delete next.technician;
                        return next;
                      });
                    }}
                  />
                ) : (
                  <label>
                    {label}
                    <textarea
                      value={patch.resolution ?? ''}
                      disabled={busy}
                      maxLength={12000}
                      onChange={(e) =>
                        setPatch((current) => {
                          const next = { ...current };
                          if (e.target.value.trim()) next.resolution = e.target.value;
                          else delete next.resolution;
                          return next;
                        })
                      }
                    />
                  </label>
                )}
                {(key === 'group' || key === 'technician') && (
                  <label className="ticket-check">
                    <input
                      type="checkbox"
                      checked={patch[key] === null}
                      disabled={busy}
                      onChange={(event) => {
                        if (key === 'group') setGroupId(undefined);
                        setPatch((current) => {
                          const next = { ...current };
                          if (key === 'group') delete next.technician;
                          if (event.target.checked) next[key] = null;
                          else delete next[key];
                          return next;
                        });
                      }}
                    />
                    <span>Unassign </span>
                    {label.toLowerCase()}
                  </label>
                )}
              </div>
            ))}
          </div>
        ))}
    </Modal>
  );
}

export function SdpBulkControls({
  view,
  disabled,
  ids,
  onSelect,
  onOpen,
}: Readonly<{
  view?: SdpAccountView;
  disabled: boolean;
  ids: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (tickets: SdpQueueTicket[]) => void;
}>) {
  const tickets = view?.queuePage?.tickets ?? [];
  const unavailable = disabled || view?.snapshot?.source !== 'live';
  let selectionLabel = tickets.length > 20 ? 'Select first 20' : 'Select page';
  if (ids.length) selectionLabel = 'Clear selection';
  return (
    <>
      <TactileButton
        size="sm"
        variant="ghost"
        disabled={unavailable || !tickets.length}
        onClick={() => onSelect(ids.length ? [] : tickets.slice(0, 20).map((t) => t.id))}
      >
        {selectionLabel}
      </TactileButton>
      {ids.length > 0 && (
        <TactileButton
          size="sm"
          disabled={unavailable || !ids.length}
          onClick={() => onOpen(tickets.filter((t) => ids.includes(t.id)))}
        >
          Update selected ({ids.length})
        </TactileButton>
      )}
    </>
  );
}
