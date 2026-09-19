import { useEffect, useRef, useState } from 'react';
import {
  SDP_RESOURCE_FIELDS,
  SDP_RESOURCE_LABELS,
  SdpResourceMutationSchema,
  type SdpResourceName,
  type SdpResourcePage,
  type SdpResourceMutation,
} from '@shared/sdpResources';
import type { SdpAccountView } from '@shared/sdpAccount';
import type { SdpReview } from '@shared/sdpMutation';
import { TactileButton } from '../../components/TactileButton';
import { Modal } from '../../components/Modal';
import { SdpBody } from './SdpTicketContent';

export function SdpResourcesPanel({
  id,
  enabled,
  onResult,
}: Readonly<{
  id: string;
  enabled: boolean;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [resource, setResource] = useState<SdpResourceName>();
  const [levelId, setLevelId] = useState<string>();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SdpResourcePage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<SdpResourceMutation>();
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError('');
    if (!resource || !enabled) return;
    setBusy(true);
    void globalThis.api!.sdpAccount!({ action: 'readResources', id, resource, levelId, page })
      .then((result) => {
        if (!active) return;
        if (result.success && result.data?.resources) setData(result.data.resources);
        else
          setError('This section could not be loaded. Check your connection and SDP permissions.');
      })
      .catch(() => {
        if (active) setError('This section is unavailable. Reconnect and try again.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [id, resource, levelId, page, enabled]);
  function choose(next: SdpResourceName, level?: string) {
    setResource(next);
    setLevelId(level);
    setPage(0);
  }
  function edit(
    operation: SdpResourceMutation['operation'],
    row?: SdpResourcePage['rows'][number],
  ) {
    if (!resource) return;
    const fields = operation === 'update' ? { ...row?.fields } : {};
    if (fields.description) {
      const doc = new DOMParser().parseFromString(fields.description, 'text/html');
      fields.description = doc.body.textContent ?? '';
    }
    setEditor({ kind: 'resource', id, resource, levelId, recordId: row?.id, operation, fields });
  }
  return (
    <section className="ticket-related" aria-label="Ticket work">
      <div className="ticket-actions">
        {(['tasks', 'worklogs', 'approval_levels'] as const).map((value) => (
          <TactileButton
            key={value}
            size="sm"
            disabled={!enabled || busy}
            onClick={() => choose(value)}
          >
            {SDP_RESOURCE_LABELS[value]}
          </TactileButton>
        ))}
      </div>
      {!enabled && <p>Ticket actions require a current connection to SDP.</p>}
      {busy && <p role="status">Loading…</p>}
      {error && <p role="alert">{error}</p>}
      {resource && data && (
        <>
          <div className="ticket-actions">
            <h4>{SDP_RESOURCE_LABELS[resource]}</h4>
            <TactileButton size="sm" disabled={!enabled} onClick={() => edit('create')}>
              Add {SDP_RESOURCE_LABELS[resource].toLowerCase()}
            </TactileButton>
            {resource === 'approvals' && (
              <TactileButton size="sm" onClick={() => choose('approval_levels')}>
                Back to levels
              </TactileButton>
            )}
          </div>
          {!data.rows.length && <p>No {SDP_RESOURCE_LABELS[resource].toLowerCase()}.</p>}
          {data.rows.map((row) => (
            <article key={row.id} className="ticket-related">
              <h4>{resource === 'worklogs' ? `Worklog ${row.id}` : row.title}</h4>
              {row.status && <p>{row.status}</p>}
              <dl className="ticket-metadata">
                {Object.entries(row.fields)
                  .filter(([key]) => key !== 'description')
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{(SDP_RESOURCE_FIELDS[resource] as Record<string, string>)[key]}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
              </dl>
              {row.fields.description && <SdpBody html={row.fields.description} />}
              <div className="ticket-actions">
                {resource === 'approval_levels' && (
                  <TactileButton size="sm" onClick={() => choose('approvals', row.id)}>
                    View approvals
                  </TactileButton>
                )}
                {(resource === 'tasks' || resource === 'worklogs') && (
                  <TactileButton size="sm" disabled={!enabled} onClick={() => edit('update', row)}>
                    Edit
                  </TactileButton>
                )}
                {resource === 'approvals' && (
                  <>
                    <TactileButton
                      size="sm"
                      disabled={!enabled}
                      onClick={() => edit('approve', row)}
                    >
                      Approve
                    </TactileButton>
                    <TactileButton
                      size="sm"
                      disabled={!enabled}
                      onClick={() => edit('reject', row)}
                    >
                      Reject
                    </TactileButton>
                  </>
                )}
                <TactileButton size="sm" disabled={!enabled} onClick={() => edit('delete', row)}>
                  Delete
                </TactileButton>
              </div>
            </article>
          ))}
          <div className="ticket-actions">
            <TactileButton size="sm" disabled={!page || busy} onClick={() => setPage(page - 1)}>
              Previous
            </TactileButton>
            <TactileButton
              size="sm"
              disabled={!data.hasMore || page >= 99 || busy}
              onClick={() => setPage(page + 1)}
            >
              Next
            </TactileButton>
          </div>
        </>
      )}
      {editor && (
        <ResourceEditor initial={editor} onClose={() => setEditor(undefined)} onResult={onResult} />
      )}
    </section>
  );
}
function ResourceEditor({
  initial,
  onClose,
  onResult,
}: Readonly<{
  initial: SdpResourceMutation;
  onClose: () => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [fields, setFields] = useState(initial.fields);
  const [review, setReview] = useState<SdpReview>();
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const labels = SDP_RESOURCE_FIELDS[initial.resource] as Record<string, string>;
  const destructive = initial.operation === 'delete';
  const decision = initial.operation === 'approve' || initial.operation === 'reject';
  const visible = destructive
    ? []
    : Object.keys(labels).filter((key) => !decision || key === 'comments');
  async function prepare() {
    if (locked.current) return;
    const changed = Object.entries(fields).filter(([key, value]) =>
      initial.operation !== 'update' ? value.trim() : value !== initial.fields[key],
    );
    const patch = Object.fromEntries(changed);
    if (initial.resource === 'worklogs' && ('hours' in patch || 'minutes' in patch)) {
      patch.hours = fields.hours || '0';
      patch.minutes = fields.minutes || '0';
    }
    const parsed = SdpResourceMutationSchema.safeParse({ ...initial, fields: patch });
    if (!parsed.success) {
      setMessage(parsed.error.issues.map((item) => item.message).join(' '));
      return;
    }
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await globalThis.api!.sdpAccount!({
        action: 'prepareChange',
        mutation: parsed.data,
      });
      if (!result.success || !result.data?.review) throw new Error();
      setReview(result.data.review);
    } catch {
      setMessage('Could not prepare this change. Refresh the ticket and check your permissions.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review || locked.current) return;
    locked.current = true;
    setBusy(true);
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data) throw new Error();
      setMessage(result.data.message ?? 'Check SDP for the result.');
      onResult(result.data);
    } catch {
      setMessage(
        'The result is uncertain. Check SDP before trying again; Relay will not retry automatically.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
      setFinished(true);
    }
  }
  function close() {
    if (!busy) {
      void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
      onClose();
    }
  }
  return (
    <Modal
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      isOpen
      width="760px"
      title={`${initial.operation} · ${SDP_RESOURCE_LABELS[initial.resource]}`}
      subtitle={`Ticket ${initial.id} · Your work account`}
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
              onClick={() => void (review ? confirm() : prepare())}
            >
              {review ? 'Confirm live change' : 'Review change'}
            </TactileButton>
          )}
        </>
      }
    >
      {message && <p role="status">{message}</p>}
      {!finished &&
        (review ? (
          <section aria-label="Review live change">
            <p>
              {initial.operation} {SDP_RESOURCE_LABELS[initial.resource].toLowerCase()}
              {initial.recordId ? ` ${initial.recordId}` : ''} on ticket {initial.id}. This changes
              SDP using your work account and may trigger its workflows.
            </p>
            {destructive && (
              <p>
                This removes the selected record. Confirm only after checking its ticket and
                identifier.
              </p>
            )}
            <dl className="ticket-metadata">
              {Object.entries(
                review.mutation.kind === 'resource' ? review.mutation.fields : {},
              ).map(([key, value]) => (
                <div key={key}>
                  <dt>{labels[key]}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : (
          <div className="ticket-form-grid">
            {destructive && <p>Review deletion of record {initial.recordId} before submitting.</p>}
            {visible.map((key) => (
              <label key={key}>
                {labels[key]}
                {['description', 'comments'].includes(key) ? (
                  <textarea
                    rows={4}
                    maxLength={12000}
                    value={fields[key] ?? ''}
                    onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                  />
                ) : (
                  <ResourceField
                    label={labels[key] ?? key}
                    field={key}
                    value={fields[key] ?? ''}
                    onChange={(value) => setFields({ ...fields, [key]: value })}
                  />
                )}
              </label>
            ))}
          </div>
        ))}
    </Modal>
  );
}

function ResourceField({
  label,
  field,
  value,
  onChange,
}: Readonly<{ label: string; field: string; value: string; onChange: (value: string) => void }>) {
  if (field === 'includeNonoperational')
    return (
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Use SDP default</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (/Time|Start|End/.test(field)) {
    const date = new Date(value);
    const local =
      value && Number.isFinite(date.getTime())
        ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : '';
    return (
      <input
        type="datetime-local"
        value={local}
        onChange={(event) => {
          const next = new Date(event.target.value);
          onChange(Number.isFinite(next.getTime()) ? next.toISOString() : '');
        }}
      />
    );
  }
  const numeric =
    /^(completion|effortDays|effortHours|effortMinutes|additionalCost|hours|minutes|techCharge|otherCharge|exchangeRate|level)$/.test(
      field,
    );
  let type = 'text';
  if (field.endsWith('Email')) type = 'email';
  else if (numeric) type = 'number';
  return (
    <input
      maxLength={250}
      type={type}
      min={numeric ? 0 : undefined}
      step={numeric ? 'any' : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
