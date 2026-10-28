import {
  SdpStandardSelect,
  prepareSdpChange,
  standardFieldKey,
  useStandardIds,
} from './SdpStandardSelect';
import { useRef, useState, type ReactNode } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import {
  SdpMutationSchema,
  SDP_DEFAULT_INCIDENT_TEMPLATE,
  type SdpMutation,
  type SdpRequestFields,
  type SdpReview,
} from '@shared/sdpMutation';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
import { SdpClosingFieldList, useSdpClosingFields } from './SdpClosingFields';

export type SdpChangeMode = 'create' | 'major' | 'note' | 'close';

const listNames = (names: readonly string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
const UNCERTAIN =
  'The result is uncertain. Check the ticket in SDP before trying again. Relay will not retry this change.';
/** SDP's own reason for not preparing a change, such as a missing required field. */
class NotPreparedError extends Error {}
/** Prepares and confirms one single-use change; `progress.submitted` once SDP may have it. */
async function confirmNow(change: SdpMutation, progress: { submitted: boolean }) {
  const prepared = await prepareSdpChange(change);
  const confirmationId = prepared.success ? prepared.data?.review?.confirmationId : undefined;
  if (!confirmationId)
    throw new NotPreparedError(
      (prepared.success && prepared.data?.message) ||
        'Could not prepare this change. Refresh the live ticket and check your connection.',
    );
  // The review is consumed before submission; an uncertain response is never replayed.
  progress.submitted = true;
  const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
  if (!result.success || !result.data) throw new Error(UNCERTAIN);
  return result.data;
}
export function SdpChangeDialog({
  mode,
  ticket,
  closeStatus = 'Closed',
  onClose,
  onResult,
}: Readonly<{
  mode: SdpChangeMode;
  ticket?: SdpQueueTicket;
  /** The done status Close Ticket sets: Closed, or the status chosen in the ticket list. */
  closeStatus?: string;
  onClose: () => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [defaults] = useState<Record<string, string>>((): Record<string, string> => {
    if (mode === 'major')
      return { requestType: 'Incident', impact: 'Single User', urgency: 'Medium' };
    // Close Ticket is SDP's Close: the status is fixed; the resolution and any field SDP requires
    // to close are entered.
    return mode === 'close' ? { status: closeStatus } : {};
  });
  const [fields, setFields] = useState<Record<string, string>>(defaults);
  // SDP IDs of chosen values; the form's own defaults are looked up as it opens.
  const defaultIds = useStandardIds(defaults);
  const [chosenIds, setChosenIds] = useState<Record<string, string | undefined>>({});
  const [groupId, setGroupId] = useState<string>();
  const [review, setReview] = useState<SdpReview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SdpNotice>();
  const [finished, setFinished] = useState(false);
  // A change finishes even while Tickets is hidden, so its result and Done state are never lost.
  const locked = useRef(false);
  const closing = useSdpClosingFields(mode === 'close' ? ticket?.id : undefined);
  const creating = mode === 'create' || mode === 'major';
  // Closing and noting a ticket state their whole effect in the form, so one press prepares and
  // confirms the single-use change; new tickets keep the separate review of every field.
  const direct = mode === 'close' || mode === 'note';
  function mutation(): SdpMutation {
    if (mode === 'note')
      return SdpMutationSchema.parse({
        kind: 'note',
        id: ticket!.id,
        body: fields.body ?? '',
        showToRequester: fields.visibility === 'requester',
      });
    const patch: SdpRequestFields = {};
    const editable = [
      'subject',
      'description',
      'status',
      'priority',
      'group',
      'technician',
      'requestType',
      'category',
      'impact',
      'urgency',
      'resolution',
    ] as const;
    for (const key of editable) {
      if (fields[key]?.trim()) patch[key] = fields[key].trim();
    }
    if (fields.group === '(Unassigned)') patch.group = null;
    if (fields.technician === '(Unassigned)') patch.technician = null;
    const ids = { ...defaultIds, ...chosenIds };
    const fieldIds = Object.fromEntries(
      Object.entries(ids).filter(
        ([key, value]) =>
          value &&
          standardFieldKey(key) &&
          typeof patch[key as keyof SdpRequestFields] === 'string',
      ),
    );
    const withIds = Object.keys(fieldIds).length ? { fieldIds } : {};
    if (creating)
      return SdpMutationSchema.parse({
        kind: 'create',
        fields: patch,
        templateId:
          mode === 'major' ? SDP_DEFAULT_INCIDENT_TEMPLATE.id : fields.templateId || undefined,
        requesterEmail: fields.requesterEmail || undefined,
        majorIncident: mode === 'major',
        ...withIds,
      });
    return SdpMutationSchema.parse({ kind: 'update', id: ticket!.id, fields: patch, ...withIds });
  }
  /** Why the form cannot be sent yet, before anything reaches SDP. */
  function incomplete(): string | undefined {
    if (mode === 'close' && !fields.resolution?.trim())
      return 'Enter the resolution to close this ticket.';
    if (mode === 'close' && closing.loading)
      return 'Wait while Relay checks the fields SDP requires to close this ticket.';
    if (mode === 'close' && closing.unfilled.length)
      return `Fill in ${listNames(closing.unfilled)} to close this ticket. SDP requires ${closing.unfilled.length > 1 ? 'them' : 'it'}.`;
    if (mode === 'note' && !fields.body?.trim()) return 'Enter the note.';
    return undefined;
  }
  /** SDP refuses a close that leaves a required field empty, so those fields are saved first. */
  async function applyNow(progress: { submitted: boolean }) {
    if (mode === 'close' && Object.keys(closing.patch).length) {
      const saved = await confirmNow(
        SdpMutationSchema.parse({ kind: 'edit', id: ticket!.id, fields: closing.patch }),
        progress,
      );
      if (!saved.changeResult) return saved;
      onResult(saved);
      closing.saved();
      progress.submitted = false;
    }
    return confirmNow(mutation(), progress);
  }
  async function submitNow() {
    if (locked.current) return;
    const missing = incomplete();
    if (missing) {
      setMessage(sdpError(missing));
      return;
    }
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    const progress = { submitted: false };
    let done = false;
    try {
      const view = await applyNow(progress);
      onResult(view);
      done = !!view.changeResult;
      if (!done) {
        setMessage(sdpError(view.message ?? UNCERTAIN));
        setFinished(true);
      }
    } catch (error) {
      if (progress.submitted) {
        setMessage(sdpError(UNCERTAIN));
        setFinished(true);
      } else
        setMessage(
          sdpError(
            error instanceof NotPreparedError
              ? error.message
              : 'Could not prepare this change. Check the note length and try again.',
          ),
        );
    } finally {
      locked.current = false;
      setBusy(false);
    }
    // A confirmed close or note needs nothing more here; the ticket reloads with the result.
    if (done) onClose();
  }
  async function prepare() {
    if (locked.current) return;
    if (
      mode === 'major' &&
      ['requesterEmail', 'requestType', 'impact', 'urgency'].some((field) => !fields[field]?.trim())
    ) {
      setMessage(
        sdpError(
          'Enter a requester email, request type, impact and urgency for the default template.',
        ),
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const data = mutation();
      const result = await prepareSdpChange(data);
      if (!result.success || !result.data?.review)
        throw new Error(
          (result.success && result.data?.message) ||
            'Could not prepare this change. Refresh the live ticket and check your connection.',
        );
      setReview(result.data.review);
    } catch (error) {
      setMessage(
        sdpError(
          error instanceof Error && !('issues' in error)
            ? error.message
            : 'Enter a subject or at least one change. Check the email, template ID and field lengths.',
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage(undefined);
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data)
        throw new Error('The result is uncertain. Check the ticket in SDP before trying again.');
      setMessage(sdpInfo(result.data.message ?? 'Check SDP for the result.'));
      onResult(result.data);
    } catch {
      setMessage(
        sdpError(
          'The result is uncertain. Check the ticket in SDP before trying again. Relay will not retry this change.',
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
      setFinished(true);
    }
  }
  function close() {
    if (locked.current) return;
    void globalThis.api?.sdpAccount?.({ action: 'cancelChange' }).catch(() => undefined);
    onClose();
  }
  const closeLabel = closeStatus === 'Closed' ? 'Close' : `Mark ${closeStatus}`;
  const title = {
    major: 'Create major incident',
    create: 'New SDP ticket',
    note: 'Add note',
    close: `${closeLabel} ticket`,
  }[mode];
  const createInputs = [
    'subject',
    'description',
    'status',
    'priority',
    'group',
    'technician',
    'category',
    'templateId',
    'requesterEmail',
    'requestType',
    'impact',
    'urgency',
  ];
  const inputs = {
    create: createInputs,
    major: createInputs.filter((field) => field !== 'templateId'),
    close: ['resolution'],
    note: ['body'],
  }[mode];
  const labels: Record<string, string> = {
    subject: 'Subject',
    description: 'Description',
    status: 'Status',
    priority: 'Priority',
    group: 'Support group',
    technician: 'Technician',
    requestType: 'Request type',
    category: 'Category',
    impact: 'Impact',
    urgency: 'Urgency',
    resolution: 'Resolution',
    templateId: 'Template ID',
    requesterEmail: 'Requester email',
    body: 'Note',
  };
  // The incident template requires these; any new ticket needs a subject.
  const required = new Set(
    mode === 'major'
      ? ['subject', 'requesterEmail', 'requestType', 'impact', 'urgency']
      : ['subject'],
  );
  const input = (key: string) => (
    <ChangeField
      key={key}
      field={key}
      label={labels[key] ?? key}
      value={fields[key] ?? ''}
      required={creating && required.has(key)}
      groupId={groupId}
      disabled={busy}
      onCommit={direct ? () => void submitNow() : undefined}
      onChange={(value, id) => {
        if (key === 'group') setGroupId(id);
        // A chosen value replaces a default's ID; a new group drops the technician's.
        setChosenIds((old) => ({
          ...old,
          [key]: id ?? '',
          ...(key === 'group' ? { technician: '' } : {}),
        }));
        setFields((old) => ({
          ...old,
          [key]: value,
          ...(key === 'group' ? { technician: '' } : {}),
        }));
      }}
    />
  );
  const editFields = creating ? (
    <CreateSections major={mode === 'major'} inputs={inputs} input={input} />
  ) : (
    <div className="ticket-form-grid">
      {mode === 'close' && (
        <p className="ticket-form-wide">
          Closes ticket {ticket?.number} in SDP: the status becomes {closeStatus} with this
          resolution, after saving any field SDP requires to close. SDP&apos;s workflows may send
          notifications. Relay does not retry.
        </p>
      )}
      {mode === 'close' && ticket && (
        <SdpClosingFieldList closing={closing} ticketId={ticket.id} disabled={busy} />
      )}
      {mode === 'note' && (
        <p className="ticket-form-wide">
          Adds this note to ticket {ticket?.number} in SDP. No email notification is requested.
        </p>
      )}
      {inputs.map(input)}
      {mode === 'note' && (
        <label>
          <span>Visibility</span>
          <select
            aria-label="Visibility"
            value={fields.visibility ?? 'private'}
            disabled={busy}
            onChange={(event) => setFields({ ...fields, visibility: event.target.value })}
          >
            <option value="private">Technicians only</option>
            <option value="requester">Visible to requester</option>
          </select>
        </label>
      )}
    </div>
  );
  return (
    <Modal
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      isOpen
      width="760px"
      title={title}
      subtitle={ticket ? `Ticket ${ticket.number} in your work account` : 'Your work account'}
      onClose={close}
      footer={
        <>
          <TactileButton disabled={busy} onClick={close}>
            {finished ? 'Done' : 'Cancel'}
          </TactileButton>
          {!finished && direct && (
            <TactileButton
              variant="primary"
              loading={busy}
              disabled={closing.loading}
              onClick={() => void submitNow()}
            >
              {mode === 'close' ? `${closeLabel} Ticket` : 'Add Note'}
            </TactileButton>
          )}
          {!finished &&
            !direct &&
            (review ? (
              <TactileButton
                variant="primary"
                disabled={busy || review.expiresAt <= Date.now()}
                onClick={() => void confirm()}
              >
                Save
              </TactileButton>
            ) : (
              <TactileButton variant="primary" disabled={busy} onClick={() => void prepare()}>
                Review Change
              </TactileButton>
            ))}
        </>
      }
    >
      <SdpMessage message={message} />
      {!finished &&
        (review ? (
          <section aria-label="Review live change">
            <p>
              This will{' '}
              {review.mutation.kind === 'create'
                ? 'create a real ticket'
                : `change ticket ${ticket?.number}`}{' '}
              in SDP using your account. SDP workflows may send notifications. No automatic retry.
            </p>
            {mode === 'major' && (
              <p>
                Template: {SDP_DEFAULT_INCIDENT_TEMPLATE.name}. Major incident: Yes (checked in
                SDP).
              </p>
            )}
            {review.mutation.kind === 'note' && (
              <p>
                Visibility:{' '}
                {review.mutation.showToRequester ? 'Visible to requester' : 'Technicians only'}. No
                email notification is requested.
              </p>
            )}
            <dl className="ticket-metadata ticket-metadata--preformatted">
              {Object.entries(fields)
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{labels[key] ?? key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            <TactileButton
              size="sm"
              onClick={() => {
                setReview(undefined);
                void globalThis.api
                  ?.sdpAccount?.({ action: 'cancelChange' })
                  .catch(() => undefined);
              }}
            >
              Back to Editing
            </TactileButton>
          </section>
        ) : (
          editFields
        ))}
    </Modal>
  );
}

function CreateSections({
  major,
  inputs,
  input,
}: Readonly<{ major: boolean; inputs: readonly string[]; input: (key: string) => ReactNode }>) {
  return (
    <div className="sdp-template-sections sdp-create-form">
      <p className="sdp-editor-note">
        {major &&
          `Filed with the ${SDP_DEFAULT_INCIDENT_TEMPLATE.name} template and marked Major incident in SDP. `}
        Fields marked * are required.
      </p>
      {CREATE_SECTIONS.map((section) => (
        <fieldset key={section.name}>
          <legend>{section.name}</legend>
          <div className="ticket-form-grid">
            {section.fields.filter((key) => inputs.includes(key)).map(input)}
          </div>
        </fieldset>
      ))}
      {inputs.includes('templateId') && (
        <details className="sdp-form-advanced">
          <summary>SDP template</summary>
          <div className="ticket-form-grid">{input('templateId')}</div>
          <p className="sdp-editor-note">Leave blank to use SDP's default template.</p>
        </details>
      )}
    </div>
  );
}

/** New tickets group their fields the way a ticket is written: what, who, where, how urgent. */
const CREATE_SECTIONS = [
  { name: 'Request', fields: ['subject', 'description'] },
  { name: 'Requester', fields: ['requesterEmail', 'requestType'] },
  { name: 'Assignment', fields: ['group', 'technician', 'category'] },
  { name: 'Status and priority', fields: ['status', 'priority', 'impact', 'urgency'] },
];
function ChangeField({
  field,
  label,
  value,
  required = false,
  groupId,
  disabled,
  onCommit,
  onChange,
}: Readonly<{
  field: string;
  label: string;
  value: string;
  required?: boolean;
  groupId?: string;
  disabled: boolean;
  /** Ctrl/Cmd+Enter in a multiline field sends the form without reaching for the button. */
  onCommit?: () => void;
  onChange: (value: string, id?: string) => void;
}>) {
  const standard = standardFieldKey(field);
  if (standard)
    return (
      <SdpStandardSelect
        field={standard}
        label={label}
        value={value}
        groupId={groupId}
        disabled={disabled}
        allowUnassign={field === 'group' || field === 'technician'}
        required={required}
        onChange={onChange}
      />
    );
  const multiline = ['description', 'resolution', 'body'].includes(field);
  const wide = multiline || field === 'subject';
  let length = 200;
  if (field === 'subject') length = 250;
  return (
    <label className={wide ? 'ticket-form-wide' : ''}>
      <span>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {multiline ? (
        <textarea
          aria-label={label}
          aria-required={required || undefined}
          rows={5}
          maxLength={12000}
          value={value}
          disabled={disabled}
          onKeyDown={(event) => {
            if (!onCommit || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            onCommit();
          }}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          aria-required={required || undefined}
          maxLength={length}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
