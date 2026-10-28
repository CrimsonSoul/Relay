import { SdpStandardSelect, prepareSdpChange, standardFieldKey } from './SdpStandardSelect';
import { useRef, useState } from 'react';
import {
  SDP_SERVER_UPDATE_MESSAGE,
  type SdpAccountView,
  type SdpQueueTicket,
} from '@shared/sdpAccount';
import {
  SDP_BULK_MAX,
  SdpBulkMutationSchema,
  type SdpBulkResult,
  type SdpFieldIds,
  type SdpRequestFields,
  type SdpReview,
} from '@shared/sdpMutation';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
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
  /** `sent` is true once the update was confirmed; a cancelled dialog sent nothing. */
  onClose: (sent: boolean) => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [patch, setPatch] = useState<SdpRequestFields>({});
  const [groupId, setGroupId] = useState<string>();
  // SDP IDs of the chosen values, sent so SDP need not match them by name.
  const [fieldIds, setFieldIds] = useState<SdpFieldIds>({});
  const [review, setReview] = useState<SdpReview>();
  const [results, setResults] = useState<SdpBulkResult>();
  const [message, setMessage] = useState<SdpNotice>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const locked = useRef(false);
  async function submit() {
    if (locked.current || finished) return;
    const chosenIds = Object.fromEntries(
      Object.entries(fieldIds).filter(
        ([key, value]) => value && typeof patch[key as keyof SdpRequestFields] === 'string',
      ),
    );
    const parsed = SdpBulkMutationSchema.safeParse({
      kind: 'bulk',
      ids: tickets.map((t) => t.id),
      fields: patch,
      ...(Object.keys(chosenIds).length ? { fieldIds: chosenIds } : {}),
    });
    if (!parsed.success) {
      setMessage(sdpError(`Choose at least one change for up to ${SDP_BULK_MAX} tickets.`));
      return;
    }
    const confirming = !!review;

    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    if (confirming) {
      setReview(undefined);
      setFinished(true);
    }
    try {
      const result = review
        ? await globalThis.api!.sdpAccount!({
            action: 'confirmChange',
            confirmationId: review.confirmationId,
          })
        : await prepareSdpChange(parsed.data);
      // A server that predates 100-ticket batches refuses larger ones before preparing anything.
      if (!confirming && !result.success && result.error === SDP_SERVER_UPDATE_MESSAGE) {
        setMessage(
          sdpError(
            'The Relay server needs an update to change more than 20 tickets at once. Select 20 or fewer.',
          ),
        );
        return;
      }
      if (!result.success || !result.data)
        throw new Error('SdpBulkDialog: SDP operation did not return the expected result.');
      if (confirming) {
        setResults(result.data.bulkResult);
        setMessage(sdpInfo(result.data.message ?? 'Check each ticket in SDP.'));
        onResult(result.data);
      } else if (result.data.review?.mutation.kind === 'bulk') setReview(result.data.review);
      // SDP's reason for not preparing, such as a close missing required fields.
      else if (result.data.message) setMessage(sdpError(result.data.message));
      else throw new Error('SdpBulkDialog: SDP operation did not return the expected result.');
    } catch {
      setMessage(
        sdpError(
          confirming
            ? 'The result is uncertain. Check all selected tickets in SDP before trying again. Nothing will be retried automatically.'
            : 'Could not prepare these changes. Refresh the queue and check your access.',
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    void globalThis.api?.sdpAccount?.({ action: 'cancelChange' }).catch(() => undefined);
    onClose(finished);
  }
  const changeNoun = tickets.length === 1 ? 'Change' : 'Changes';
  return (
    <Modal
      isOpen
      title="Update selected tickets"
      subtitle={`${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'} in your work account`}
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
              {review ? `Save ${tickets.length} ${changeNoun}` : 'Review Bulk Changes'}
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
      <SdpMessage message={message} />
      {!finished &&
        (review ? (
          <dl className="ticket-metadata">
            {Object.entries(patch).map(([key, value]) => (
              <div key={key}>
                <dt>{fields[key as keyof typeof fields]}</dt>
                <dd>{value ?? 'Unassigned'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="ticket-form-grid">
            <p>Leave a field blank to keep its current value.</p>
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
                      setFieldIds((current) => ({ ...current, [key]: id }));
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

/** Rows are checked in the queue table (its header checks the whole page). */
export function SdpBulkControls({
  tickets,
  live,
  disabled,
  ids,
  onSelect,
  onOpen,
}: Readonly<{
  /** Every loaded row, including those from earlier pages that Load More kept. */
  tickets: SdpQueueTicket[];
  live: boolean;
  disabled: boolean;
  ids: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (tickets: SdpQueueTicket[]) => void;
}>) {
  const unavailable = disabled || !live;
  return (
    <>
      {ids.length > 0 && (
        <TactileButton variant="ghost" disabled={unavailable} onClick={() => onSelect([])}>
          Clear Selection
        </TactileButton>
      )}
      {ids.length > 0 && (
        <TactileButton
          disabled={unavailable || !ids.length}
          onClick={() => onOpen(tickets.filter((t) => ids.includes(t.id)))}
        >
          Update Selected ({ids.length})
        </TactileButton>
      )}
    </>
  );
}
