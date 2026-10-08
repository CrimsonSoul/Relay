import { SdpStandardSelect, standardFieldKey } from './SdpStandardSelect';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export type SdpChangeMode = 'create' | 'major' | 'update' | 'note' | 'close';
export function SdpChangeDialog({
  mode,
  ticket,
  onClose,
  onResult,
}: Readonly<{
  mode: SdpChangeMode;
  ticket?: SdpQueueTicket;
  onClose: () => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [fields, setFields] = useState<Record<string, string>>((): Record<string, string> => {
    if (mode === 'major')
      return { requestType: 'Incident', impact: 'Single User', urgency: 'Medium' };
    // Close Ticket is SDP's Close: the status is fixed and only the resolution is entered.
    return mode === 'close' ? { status: 'Closed' } : {};
  });
  const [groupId, setGroupId] = useState<string>();
  const [review, setReview] = useState<SdpReview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<SdpNotice>();
  const [finished, setFinished] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const creating = mode === 'create' || mode === 'major';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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
    if (creating)
      return SdpMutationSchema.parse({
        kind: 'create',
        fields: patch,
        templateId:
          mode === 'major' ? SDP_DEFAULT_INCIDENT_TEMPLATE.id : fields.templateId || undefined,
        requesterEmail: fields.requesterEmail || undefined,
        majorIncident: mode === 'major',
      });
    return SdpMutationSchema.parse({ kind: 'update', id: ticket!.id, fields: patch });
  }
  async function prepare() {
    if (locked.current) return;
    if (mode === 'close' && !fields.resolution?.trim()) {
      setMessage(sdpError('Enter the resolution to close this ticket.'));
      return;
    }
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
      const result = await globalThis.api!.sdpAccount!({ action: 'prepareChange', mutation: data });
      if (!result.success || !result.data?.review)
        throw new Error(
          'Could not prepare this change. Refresh the live ticket and check your connection.',
        );
      if (alive.current) setReview(result.data.review);
    } catch (error) {
      if (alive.current)
        setMessage(
          sdpError(
            error instanceof Error && !('issues' in error)
              ? error.message
              : 'Enter a subject or at least one change. Check the email, template ID and field lengths.',
          ),
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
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
      if (alive.current) {
        setMessage(sdpInfo(result.data.message ?? 'Check SDP for the result.'));
        onResult(result.data);
      }
    } catch {
      if (alive.current)
        setMessage(
          sdpError(
            'The result is uncertain. Check the ticket in SDP before trying again. Relay will not retry this change.',
          ),
        );
    } finally {
      locked.current = false;
      if (alive.current) {
        setBusy(false);
        setFinished(true);
      }
    }
  }
  function close() {
    if (locked.current) return;
    void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
    onClose();
  }
  const title = {
    major: 'Create major incident',
    create: 'New SDP ticket',
    note: 'Add note',
    close: 'Close ticket',
    update: 'Edit ticket',
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
    update: [
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
    ],
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
      ticket={ticket}
      groupId={groupId}
      disabled={busy}
      onChange={(value, id) => {
        if (key === 'group') setGroupId(id);
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
      {mode === 'update' && (
        <p className="ticket-form-wide">Leave a field blank to keep its current value.</p>
      )}
      {mode === 'close' && (
        <p className="ticket-form-wide">
          SDP sets the status to Closed and records this resolution. Its closure rules may require
          other fields first.
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
          {!finished &&
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
                void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
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
  ticket,
  groupId,
  disabled,
  onChange,
}: Readonly<{
  field: string;
  label: string;
  value: string;
  required?: boolean;
  ticket?: SdpQueueTicket;
  groupId?: string;
  disabled: boolean;
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
  const placeholders: Record<string, string | undefined> = {
    status: ticket?.status,
    priority: ticket?.priority,
    group: ticket?.group,
  };
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
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          aria-required={required || undefined}
          maxLength={length}
          value={value}
          placeholder={placeholders[field]}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
