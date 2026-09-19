import { useEffect, useRef, useState } from 'react';
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

export type SdpChangeMode = 'create' | 'major' | 'update' | 'note' | 'resolve';
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
  const [fields, setFields] = useState<Record<string, string>>((): Record<string, string> =>
    mode === 'major' ? { requestType: 'Incident', impact: 'Single User', urgency: 'Medium' } : {},
  );
  const [review, setReview] = useState<SdpReview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
    if (mode === 'resolve' && (!fields.resolution?.trim() || !fields.status?.trim())) {
      setMessage('Enter the resolution and the exact target status from SDP.');
      return;
    }
    if (
      mode === 'major' &&
      ['requesterEmail', 'requestType', 'impact', 'urgency'].some((field) => !fields[field]?.trim())
    ) {
      setMessage(
        'Enter a requester email, request type, impact and urgency for the default template.',
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setMessage('');
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
          error instanceof Error && !('issues' in error)
            ? error.message
            : 'Enter a subject or at least one change. Check the email, template ID and field lengths.',
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
    setMessage('');
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data)
        throw new Error('The result is uncertain. Check the ticket in SDP before trying again.');
      if (alive.current) {
        setMessage(result.data.message ?? 'Check SDP for the result.');
        onResult(result.data);
      }
    } catch {
      if (alive.current)
        setMessage(
          'The result is uncertain. Check the ticket in SDP before trying again. Relay will not retry this change.',
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
    resolve: 'Resolve ticket',
    update: 'Edit ticket',
  }[mode];
  const createInputs = [
    'subject',
    'description',
    'priority',
    'group',
    'templateId',
    'requesterEmail',
    'requestType',
    'impact',
    'urgency',
  ];
  const inputs = {
    create: createInputs,
    major: createInputs.filter((field) => field !== 'templateId'),
    resolve: ['resolution', 'status'],
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
    templateId: 'SDP template ID (optional)',
    requesterEmail: mode === 'major' ? 'Requester email' : 'Requester email (optional)',
    body: 'Note',
  };
  return (
    <Modal
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      isOpen
      width="760px"
      title={title}
      subtitle={ticket ? `Ticket ${ticket.number} · Your work account` : 'Your work account'}
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
                Confirm live change
              </TactileButton>
            ) : (
              <TactileButton variant="primary" disabled={busy} onClick={() => void prepare()}>
                Review change
              </TactileButton>
            ))}
        </>
      }
    >
      {message && (
        <p role="status" className="ticket-mode-note">
          {message}
        </p>
      )}
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
                Template: {SDP_DEFAULT_INCIDENT_TEMPLATE.name}. Major Incident: Yes (checked in
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
            <dl className="ticket-metadata">
              {Object.entries(fields)
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{labels[key] ?? key}</dt>
                    <dd style={{ whiteSpace: 'pre-wrap' }}>{value}</dd>
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
              Back to editing
            </TactileButton>
          </section>
        ) : (
          <div className="ticket-form-grid">
            <p className="ticket-form-wide">{formHint(mode)}</p>
            {mode === 'major' && (
              <div className="ticket-form-wide">
                <p>Template: {SDP_DEFAULT_INCIDENT_TEMPLATE.name}</p>
                <label className="ticket-form-checkbox">
                  <input type="checkbox" checked readOnly /> Major Incident
                </label>
              </div>
            )}
            {inputs.map((key) => (
              <ChangeField
                key={key}
                field={key}
                label={labels[key] ?? key}
                value={fields[key] ?? ''}
                ticket={ticket}
                onChange={(value) => setFields({ ...fields, [key]: value })}
              />
            ))}
            <datalist id="sdp-group-choices">
              <option>NOC</option>
              <option>SOX</option>
              <option>(Unassigned)</option>
            </datalist>
            <datalist id="sdp-technician-choices">
              <option>(Unassigned)</option>
            </datalist>
            {mode === 'note' && (
              <label>
                Visibility
                <select
                  aria-label="Visibility"
                  value={fields.visibility ?? 'private'}
                  onChange={(event) => setFields({ ...fields, visibility: event.target.value })}
                >
                  <option value="private">Technicians only</option>
                  <option value="requester">Visible to requester</option>
                </select>
              </label>
            )}
          </div>
        ))}
    </Modal>
  );
}

function ChangeField({
  field,
  label,
  value,
  ticket,
  onChange,
}: Readonly<{
  field: string;
  label: string;
  value: string;
  ticket?: SdpQueueTicket;
  onChange: (value: string) => void;
}>) {
  const multiline = ['description', 'resolution', 'body'].includes(field);
  const placeholders: Record<string, string | undefined> = {
    status: ticket?.status,
    priority: ticket?.priority,
    group: ticket?.group,
  };
  let length = 200;
  if (field === 'subject') length = 250;
  const choices = field === 'group' || field === 'technician' ? `sdp-${field}-choices` : undefined;
  return (
    <label className={multiline ? 'ticket-form-wide' : ''}>
      {label}
      {multiline ? (
        <textarea
          rows={5}
          maxLength={12000}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          maxLength={length}
          value={value}
          placeholder={placeholders[field]}
          list={choices}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function formHint(mode: SdpChangeMode): string {
  if (mode === 'major')
    return 'Enter the basic incident details. Requester, request type, impact and urgency are required by your default template.';
  if (mode === 'create')
    return 'Your SDP template may require additional fields. Without a template or requester, SDP applies your account defaults.';
  return 'Leave fields blank to keep their current value. Use exact names from SDP.';
}
