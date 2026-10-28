import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import { SDP_BULK_OUTCOME_MESSAGE, SdpBulkMutationSchema } from '@shared/sdpMutation';
import { SdpIcon } from './SdpIcon';
import { SdpMessage, sdpError, type SdpNotice } from './SdpMessage';
import { SdpChoiceList, useSdpChoiceList } from './SdpChoicePicker';
import { prepareSdpChange, standardChoiceLoader } from './SdpStandardSelect';
import { technicianLabel } from './sdpQueueFormat';
import { usePopoverDismiss } from './usePopoverDismiss';

const QUICK_EDIT_CLOSE_KEYS = ['Escape'] as const;

export type SdpRowField = 'status' | 'group' | 'technician';
const labels: Record<SdpRowField, string> = {
  status: 'Status',
  group: 'Group',
  technician: 'Technician',
};
const UNASSIGNED = '(Unassigned)';
const VIEWPORT_MARGIN = 8;
const UNCERTAIN =
  'The result is uncertain. Check SDP before trying again. Relay will not retry automatically.';
const NOT_PREPARED =
  'Could not prepare this change. Refresh the queue and check your SDP permissions.';

/** SDP's reason for not preparing a change, such as missing required fields, shown as written. */
class SdpNotPreparedError extends Error {}

function shownValue(ticket: SdpQueueTicket, field: SdpRowField): string {
  if (field === 'technician') return technicianLabel(ticket.technician);
  return field === 'group' ? ticket.group || 'Unassigned' : ticket.status;
}
function choiceLabel(field: SdpRowField, name: string): string {
  if (name !== UNASSIGNED) return name;
  return field === 'technician' ? 'No technician' : 'Unassigned';
}
/** The queue-level outcome names the ticket instead of describing a bulk run. */
function rowOutcome(
  ticket: SdpQueueTicket,
  field: SdpRowField,
  status: string | undefined,
  value: string,
): string {
  if (status === 'confirmed')
    return `Ticket #${ticket.number}: ${labels[field].toLowerCase()} changed to ${value}.`;
  if (status === 'conflict')
    return `Ticket #${ticket.number} changed in SDP after it was loaded, so nothing was sent. Check it and try again.`;
  return `Ticket #${ticket.number} was not confirmed by SDP. ${UNCERTAIN}`;
}

/** A chosen value: SDP's name, and its ID when SDP's list gave one. */
type RowChoice = { name: string; id?: string };
/** A one-ticket bulk change; a chosen value also carries its SDP ID. */
function rowMutation(ticket: SdpQueueTicket, field: SdpRowField, choice: RowChoice) {
  const value = choice.name === UNASSIGNED ? null : choice.name;
  return SdpBulkMutationSchema.parse({
    kind: 'bulk',
    ids: [ticket.id],
    fields: { [field]: value },
    ...(value !== null && choice.id ? { fieldIds: { [field]: choice.id } } : {}),
  });
}

/**
 * Prepares and confirms one ticket's row change; `progress.submitted` turns true once the review
 * is consumed. The returned view carries a queue message that names the ticket.
 */
async function submitRowChange(
  ticket: SdpQueueTicket,
  field: SdpRowField,
  choice: RowChoice,
  progress: { submitted: boolean },
): Promise<SdpAccountView> {
  const prepared = await prepareSdpChange(rowMutation(ticket, field, choice));
  const review = prepared.success ? prepared.data?.review : undefined;
  if (review?.mutation.kind !== 'bulk')
    throw new SdpNotPreparedError((prepared.success && prepared.data?.message) || NOT_PREPARED);
  // The review is consumed before submission; an uncertain response is never replayed.
  progress.submitted = true;
  const result = await globalThis.api!.sdpAccount!({
    action: 'confirmChange',
    confirmationId: review.confirmationId,
  });
  if (!result.success || !result.data)
    throw new Error('SdpRowQuickEdit: SDP operation did not return the expected result.');
  const status = result.data.bulkResult?.find((r) => r.id === ticket.id)?.status;
  const outcome = rowOutcome(ticket, field, status, choiceLabel(field, choice.name));
  const message = result.data.message;
  return {
    ...result.data,
    message: message?.startsWith(SDP_BULK_OUTCOME_MESSAGE)
      ? outcome + message.slice(SDP_BULK_OUTCOME_MESSAGE.length)
      : (message ?? outcome),
  };
}

/**
 * A queue row's Status, Group or Technician opens SDP's choices beside the cell. Choosing a value
 * saves it at once as a single-use live change of that one ticket (a one-ticket bulk update),
 * showing the old → new summary while it runs; Escape or clicking away closes the picker unsaved.
 * Values are plain text while the row cannot change.
 */
export function SdpRowQuickEdit({
  ticket,
  field,
  editable,
  onBusy,
  onResult,
}: Readonly<{
  ticket: SdpQueueTicket;
  field: SdpRowField;
  editable: boolean;
  onBusy: (busy: boolean) => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  // Technician choices follow the ticket's group, as in SDP; resolved when the picker opens.
  const [group, setGroup] = useState<{ name: string; id: string }>();
  const groupId = group?.name === ticket.group ? group.id : undefined;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SdpNotice>();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const label = labels[field];
  const shown = shownValue(ticket, field);
  // The queue holds while this row's change is in flight. Hiding Tickets runs this cleanup and
  // showing it runs the effect again, so the hold follows the change rather than the mount.
  useEffect(() => {
    if (!busy) return;
    onBusy(true);
    return () => onBusy(false);
  }, [busy, onBusy]);
  function close(restoreFocus: boolean) {
    if (lock.current) return;
    setOpen(false);
    setChoice('');
    setMessage(undefined);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  // A draft, a queue read or another row's change takes over; an unconfirmed choice is dropped.
  useEffect(() => {
    if (!editable && !lock.current) {
      setOpen(false);
      setChoice('');
      setMessage(undefined);
    }
  }, [editable]);
  // Escape closes this picker before the ticket shortcuts or an open ticket can answer it.
  usePopoverDismiss(open, trigger, popover, QUICK_EDIT_CLOSE_KEYS, close);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const panel = popover.current;
      if (!anchor || !panel) return;
      const { width, height } = panel.getBoundingClientRect();
      const below = anchor.bottom + 4;
      const top =
        below + height + VIEWPORT_MARGIN > globalThis.innerHeight
          ? Math.max(VIEWPORT_MARGIN, anchor.top - height - 4)
          : below;
      const maxLeft = Math.max(VIEWPORT_MARGIN, globalThis.innerWidth - width - VIEWPORT_MARGIN);
      panel.style.top = `${top}px`;
      panel.style.left = `${Math.min(Math.max(anchor.left, VIEWPORT_MARGIN), maxLeft)}px`;
      // The entrance grows out of the cell on whichever side the panel lands.
      panel.dataset.side = top < below ? 'top' : 'bottom';
    };
    place();
    // The panel grows with the review line and messages; above the cell, it must move up with them.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (popover.current) observer?.observe(popover.current);
    globalThis.addEventListener('resize', place);
    globalThis.addEventListener('scroll', place, true);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener('resize', place);
      globalThis.removeEventListener('scroll', place, true);
    };
  }, [open]);
  async function begin() {
    if (open) {
      close(false);
      return;
    }
    setOpen(true);
    setChoice('');
    setMessage(undefined);
    if (field !== 'technician' || groupId || ticket.group === 'Unassigned') {
      setReady(true);
      return;
    }
    setReady(false);
    try {
      const result = await globalThis.api!.sdpAccount!({
        action: 'readStandardOptions',
        field: 'group',
        search: ticket.group,
        page: 0,
      });
      const match = result.success
        ? result.data?.options?.choices.find(
            (c) =>
              typeof c.value === 'object' &&
              c.value.name?.toLowerCase() === ticket.group.toLowerCase(),
          )
        : undefined;
      if (match && typeof match.value === 'object')
        setGroup({ name: ticket.group, id: match.value.id });
    } catch {
      // Every technician is listed instead; SDP still checks the assignment.
    } finally {
      setReady(true);
    }
  }
  async function save(next: RowChoice) {
    if (lock.current || choiceLabel(field, next.name) === shown) return;
    lock.current = true;
    setChoice(next.name);
    setBusy(true);
    setMessage(undefined);
    const progress = { submitted: false };
    let view: SdpAccountView | undefined;
    try {
      view = await submitRowChange(ticket, field, next, progress);
    } catch (error) {
      let notice = progress.submitted ? UNCERTAIN : NOT_PREPARED;
      if (error instanceof SdpNotPreparedError) notice = error.message;
      setMessage(sdpError(notice));
    } finally {
      lock.current = false;
      setBusy(false);
    }
    // The queue reports the outcome and reloads in place; the row may leave the page.
    if (view) {
      close(true);
      onResult(view);
    } else if (progress.submitted) setChoice('');
  }

  if (!editable && !open) return <span title={shown}>{shown}</span>;
  const changed = !!choice && choiceLabel(field, choice) !== shown;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="sdp-quick-value sdp-row-value"
        aria-label={`Change ${label.toLowerCase()} for ticket ${ticket.number}, currently ${shown}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={shown}
        disabled={busy}
        onClick={() => void begin()}
      >
        <span>{shown}</span>
        <SdpIcon name="chevron" />
      </button>
      {open &&
        createPortal(
          <div // NOSONAR - non-modal popover; <dialog> would change its modality and focus handling.
            ref={popover}
            role="dialog"
            aria-label={`Change ${label.toLowerCase()} for ticket #${ticket.number}`}
            className="sdp-row-edit"
            data-motion="popover"
            onBlur={(event) => {
              // Tabbing out of the panel closes it; focus is already where the person sent it.
              const next = event.relatedTarget as Node | null;
              if (next && !event.currentTarget.contains(next) && !trigger.current?.contains(next))
                close(false);
            }}
          >
            {ready ? (
              <RowChoices
                field={field}
                label={label}
                selected={choice || ticket[field] || UNASSIGNED}
                groupId={field === 'technician' ? groupId : undefined}
                disabled={busy}
                onChoose={(next) => void save(next)}
              />
            ) : (
              <p>
                <output>Loading choices…</output>
              </p>
            )}
            {changed && (
              <p className="sdp-quick-review">
                {busy && <output>Saving… </output>}
                {label}: {shown} → {choiceLabel(field, choice)}
              </p>
            )}
            <SdpMessage message={message} />
          </div>,
          document.body,
        )}
    </>
  );
}
/** The field's SDP choices in the panel itself: one press on the cell lands in their search. */
function RowChoices({
  field,
  label,
  selected,
  groupId,
  disabled,
  onChoose,
}: Readonly<{
  field: SdpRowField;
  label: string;
  selected: string;
  groupId?: string;
  disabled: boolean;
  onChoose: (choice: RowChoice) => void;
}>) {
  const source = useSdpChoiceList(standardChoiceLoader(field, groupId), groupId ?? '');
  return (
    <div className="sdp-row-choices">
      <SdpChoiceList
        label={label}
        selected={[selected]}
        source={source}
        leading={
          field === 'status' ? [] : [{ key: UNASSIGNED, label: 'Unassigned', value: undefined }]
        }
        disabled={disabled}
        onSelect={(choice) => onChoose({ name: choice.key, id: choice.value })}
      />
    </div>
  );
}
