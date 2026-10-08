import { useEffect, useRef, useState } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import type { SdpFieldValue, SdpForm, SdpFormField } from '@shared/sdpForm';
import { SdpMutationSchema } from '@shared/sdpMutation';
import { TactileButton } from '../../components/TactileButton';
import { SdpIcon } from './SdpIcon';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
import { emptyValue, fieldLabel, patchField, SdpNativeField } from './SdpNativeEditor';
import { DueTime, technicianLabel } from './sdpQueueFormat';

const quickFields = [
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['group', 'Support group'],
  ['technician', 'Technician'],
] as const;
type QuickField = (typeof quickFields)[number][0];
const UNCERTAIN =
  'The result is uncertain. Check SDP before trying again. Relay will not retry automatically.';
const NOT_PREPARED =
  'Could not prepare this change. Refresh the ticket and check your SDP permissions.';

const shownValue = (ticket: SdpQueueTicket, key: QuickField): string =>
  key === 'technician' ? technicianLabel(ticket.technician) : ticket[key];
/** A confirmed value in the queue row's wording, shown until a re-read row replaces it. */
function rowLabel(key: string, value: SdpFieldValue): string {
  if (value !== null && !(Array.isArray(value) && !value.length)) return fieldLabel(value);
  if (key === 'technician') return 'No technician';
  return key === 'group' ? 'Unassigned' : 'Not set';
}
/** Overview overrides for confirmed quick fields, keyed to the row value they replace. */
function confirmedLabels(fields: Record<string, SdpFieldValue>, before: Map<string, string>) {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) => {
      const previous = before.get(key);
      return previous === undefined ? [] : [[key, { label: rowLabel(key, value), previous }]];
    }),
  );
}
/** Prepares and confirms one edit; `progress.submitted` turns true once the review is consumed. */
async function submitEdit(
  id: string,
  fields: Record<string, SdpFieldValue>,
  progress: { submitted: boolean },
): Promise<SdpAccountView> {
  const prepared = await globalThis.api!.sdpAccount!({
    action: 'prepareChange',
    mutation: SdpMutationSchema.parse({ kind: 'edit', id, fields }),
  });
  const review = prepared.success ? prepared.data?.review : undefined;
  if (!review) throw new Error('SdpTicketOverview: SDP did not prepare the change.');
  // The review is consumed before submission; an uncertain response is never replayed.
  progress.submitted = true;
  const result = await globalThis.api!.sdpAccount!({
    action: 'confirmChange',
    confirmationId: review.confirmationId,
  });
  if (!result.success || !result.data)
    throw new Error('SdpTicketOverview: SDP operation did not return the expected result.');
  return result.data;
}
function editableField(form: SdpForm, key: QuickField): SdpFormField | undefined {
  const field = form.fields.find((f) => f.key === key);
  return form.canEdit && field && !field.readOnly ? field : undefined;
}
/** The first editable required field left empty, as the full editor checks; SDP rejects any update until it is set. */
function missingRequired(
  form: SdpForm,
  patch: Record<string, SdpFieldValue>,
  editing?: string,
): SdpFormField | undefined {
  return form.fields.find((f) => {
    if (f.readOnly || !f.required || f.key === editing) return false;
    return emptyValue(f.key in patch ? (patch[f.key] ?? null) : f.value);
  });
}
/** Why SDP would refuse a change to this field, before anything is chosen or submitted. */
function refusal(form: SdpForm, key: QuickField, label: string): string | undefined {
  if (!form.canEdit) return 'SDP does not allow editing this ticket.';
  if (!editableField(form, key))
    return `SDP does not allow changing ${label.toLowerCase()} on this ticket.`;
  const missing = missingRequired(form, {}, key);
  return missing
    ? `${missing.label} is required by this template. Fill it in with Edit Ticket first.`
    : undefined;
}

/**
 * The ticket overview edits Status, Priority, Support group and Technician in place, as SDP does:
 * choose a value, check the old → new summary, then confirm. Each save is still a reviewed,
 * single-use live change; every other field stays in the full editor.
 */
export function SdpTicketOverview({
  ticket,
  enabled,
  onBusy,
  onResult,
}: Readonly<{
  ticket: SdpQueueTicket;
  enabled: boolean;
  onBusy: (busy: boolean) => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [form, setForm] = useState<SdpForm>();
  const [active, setActive] = useState<QuickField>();
  const [patch, setPatch] = useState<Record<string, SdpFieldValue>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SdpNotice>();
  const [confirmed, setConfirmed] = useState<
    Partial<Record<QuickField, { label: string; previous: string }>>
  >({});
  const alive = useRef(true);
  const lock = useRef(false);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
  // The full editor, a reply, Pick Up or another request takes over; an unconfirmed choice is
  // dropped, and because that work can change the ticket, the next choice reads the form again.
  useEffect(() => {
    if (enabled || lock.current) return;
    setActive(undefined);
    setPatch({});
    setForm(undefined);
    setMessage(undefined);
  }, [enabled]);
  const field = form && active ? editableField(form, active) : undefined;
  useEffect(() => {
    if (!active) return;
    // Escape cancels this choice instead of closing the ticket.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || lock.current) return;
      if (!editor.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setActive(undefined);
      setPatch({});
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [active]);
  // A choice field opens its list itself (autoOpen); any other control takes focus.
  useEffect(() => {
    if (!field) return;
    if (editor.current?.contains(document.activeElement)) return;
    editor.current?.querySelector<HTMLElement>('[role="combobox"], select, input')?.focus();
  }, [field]);

  function open(current: SdpForm, key: QuickField, label: string) {
    const reason = refusal(current, key, label);
    setActive(reason ? undefined : key);
    if (reason) setMessage(sdpError(reason));
  }
  async function begin(key: QuickField, label: string) {
    if (lock.current) return;
    setMessage(undefined);
    setPatch({});
    if (form) {
      open(form, key, label);
      return;
    }
    setActive(key);
    lock.current = true;
    setBusy(true);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'readForm', id: ticket.id });
      const loaded = result.success ? result.data?.form : undefined;
      if (!alive.current) return;
      if (!loaded) {
        setActive(undefined);
        setMessage(
          sdpError(
            result.data?.message ??
              'Could not load this ticket from SDP. Try again or use Edit Ticket.',
          ),
        );
        return;
      }
      setForm(loaded);
      open(loaded, key, label);
    } catch {
      if (alive.current) {
        setActive(undefined);
        setMessage(sdpError('Could not load this ticket from SDP. Try again or use Edit Ticket.'));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function cancel() {
    if (lock.current) return;
    setActive(undefined);
    setPatch({});
  }
  async function confirm() {
    if (lock.current || !Object.keys(patch).length) return;
    const missing = form && missingRequired(form, patch);
    if (missing) {
      setMessage(
        sdpError(
          `${missing.label} is required by this template. Choose a value or use Edit Ticket.`,
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    const fields = patch;
    const before = new Map(quickFields.map(([key]) => [key as string, shownValue(ticket, key)]));
    const progress = { submitted: false };
    try {
      const view = await submitEdit(ticket.id, fields, progress);
      if (!alive.current) return;
      onResult(view);
      if (view.changeResult) {
        setConfirmed((old) => ({ ...old, ...confirmedLabels(fields, before) }));
        setMessage(sdpInfo('Saved to SDP.'));
      } else setMessage(sdpError(view.message ?? UNCERTAIN));
    } catch {
      if (alive.current) setMessage(sdpError(progress.submitted ? UNCERTAIN : NOT_PREPARED));
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        if (progress.submitted) {
          // The loaded form holds pre-change values; the next edit reads it again.
          setForm(undefined);
          setActive(undefined);
          setPatch({});
        }
      }
    }
  }

  // Once SDP reports the ticket cannot be edited (for example, it is closed), values are plain text.
  const editable = enabled && form?.canEdit !== false;
  const values = (current: SdpForm) =>
    Object.fromEntries(
      current.fields.map((f) => [f.key, f.key in patch ? (patch[f.key] ?? null) : f.value]),
    );
  return (
    <>
      <dl className="ticket-metadata sdp-live-summary">
        {quickFields.map(([key, label]) => {
          const row = shownValue(ticket, key);
          const saved = confirmed[key];
          // A confirmed value stays until fresh data changes the row (a re-read, or the ticket left
          // this queue page and its row is no longer refreshed).
          const shown = saved && row === saved.previous ? saved.label : row;
          if (active === key)
            return (
              <div key={key} className="sdp-quick-edit">
                <dt>{label}</dt>
                <dd>
                  <div ref={editor}>
                    {!form && (
                      <p>
                        <output>Loading choices…</output>
                      </p>
                    )}
                    {form && field && (
                      <SdpNativeField
                        id={ticket.id}
                        field={field}
                        value={field.key in patch ? (patch[field.key] ?? null) : field.value}
                        values={values(form)}
                        disabled={busy}
                        hideLabel
                        autoOpen
                        onChange={(value) => {
                          const next = patchField(form, {}, field, value);
                          setPatch(field.key in next ? next : {});
                        }}
                      />
                    )}
                    {form && Object.keys(patch).length > 0 && (
                      <ul className="sdp-quick-review" aria-label="Change to confirm">
                        {Object.entries(patch).map(([changed, value]) => {
                          const source = form.fields.find((f) => f.key === changed);
                          return (
                            <li key={changed}>
                              {source?.label ?? changed}: {rowLabel(changed, source?.value ?? null)}{' '}
                              → {rowLabel(changed, value)}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="ticket-actions">
                      <TactileButton size="sm" disabled={busy} onClick={cancel}>
                        Cancel
                      </TactileButton>
                      {Object.keys(patch).length > 0 && (
                        <TactileButton
                          size="sm"
                          variant="primary"
                          loading={busy}
                          onClick={() => void confirm()}
                        >
                          Save
                        </TactileButton>
                      )}
                    </div>
                  </div>
                </dd>
              </div>
            );
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {editable ? (
                  <button
                    type="button"
                    className="sdp-quick-value"
                    aria-label={`Change ${label.toLowerCase()}, currently ${shown}`}
                    disabled={busy}
                    onClick={() => void begin(key, label)}
                  >
                    <span>{shown}</span>
                    <SdpIcon name="chevron" />
                  </button>
                ) : (
                  shown
                )}
              </dd>
            </div>
          );
        })}
        <div>
          <dt>Due</dt>
          <dd>
            <DueTime dueAt={ticket.dueAt} focusable />
          </dd>
        </div>
      </dl>
      <SdpMessage message={message} />
    </>
  );
}
