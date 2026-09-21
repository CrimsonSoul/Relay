import { useEffect, useRef, useState } from 'react';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import { SdpMutationSchema, type SdpMutation, type SdpReview } from '@shared/sdpMutation';
import type { SdpForm, SdpFormField, SdpFieldValue } from '@shared/sdpForm';
import { TactileButton } from '../../components/TactileButton';

export const fieldLabel = (value: SdpFieldValue): string => {
  if (value === null) return 'Not set';
  if (Array.isArray(value)) return value.map(fieldLabel).join(', ');
  if (typeof value === 'object') return value.name || value.id;
  return String(value);
};
const equal = (a: SdpFieldValue, b: SdpFieldValue) => JSON.stringify(a) === JSON.stringify(b);
function plain(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('script,style,iframe,object')) node.remove();
  for (const node of template.content.querySelectorAll('br')) node.replaceWith('\n');
  for (const node of template.content.querySelectorAll('p,div,li,tr')) node.append('\n');
  return template.content.textContent?.trim() ?? '';
}
const editorCommands = {
  edit: 'readForm',
  reply: 'readReplyContext',
  forward: 'readForwardContext',
} as const;
const editorTitles = {
  edit: 'Edit ticket',
  reply: 'Reply to requester',
  forward: 'Forward ticket',
};
const editorLabels = { edit: 'Edit ticket', reply: 'Reply to ticket', forward: 'Forward ticket' };
export function SdpNativeEditor({
  ticket,
  sourceId,
  mode,
  onClose,
  onResult,
}: Readonly<{
  ticket: SdpQueueTicket;
  mode: 'edit' | 'reply' | 'forward';
  sourceId?: string;
  onClose: () => void;
  onResult: (view: SdpAccountView) => void;
}>) {
  const [form, setForm] = useState<SdpForm>();
  const [patch, setPatch] = useState<Record<string, SdpFieldValue>>({});
  const [mail, setMail] = useState({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    isPublic: true,
  });
  const [ready, setReady] = useState(false);
  const [review, setReview] = useState<SdpReview>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    setBusy(true);
    void globalThis.api!.sdpAccount!({
      action: editorCommands[mode],
      id: ticket.id,
      ...(mode === 'forward' && sourceId ? { sourceId } : {}),
    })
      .then((result) => {
        if (!alive.current) return;
        if (!result.success)
          throw new Error('Could not load the SDP form. Close this editor and try again.');
        if (mode === 'edit' && result.data?.form) {
          setForm({
            ...result.data.form,
            fields: result.data.form.fields.map((f) => ({
              ...f,
              value:
                ['description', 'resolution.content'].includes(f.key) && typeof f.value === 'string'
                  ? plain(f.value)
                  : f.value,
            })),
          });
          setReady(result.data.form.canEdit);
        } else if (mode !== 'edit' && result.data?.replyContext) {
          const c = result.data.replyContext;
          setMail((m) => ({
            ...m,
            to: c.to.join(', '),
            cc: c.cc.join(', '),
            subject: c.subject,
            body: c.body ? plain(c.body) : '',
            isPublic: mode !== 'forward',
          }));
          setReady(c.canReply);
        } else {
          setMessage(result.data?.message ?? 'SDP did not return the ticket form.');
        }
      })
      .catch(() => {
        if (alive.current)
          setMessage(
            'The form is unavailable. Check your connection and SDP permissions, then reopen it.',
          );
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
    };
  }, [ticket.id, mode, sourceId]);
  function change(field: SdpFormField, value: SdpFieldValue) {
    setPatch((previous) => {
      const next = { ...previous, [field.key]: value };
      // A changed parent invalidates dependent selections, including grandchildren.
      const cleared = new Set([field.key]);
      for (let i = 0; i < 3; i++)
        for (const dependent of form?.fields ?? [])
          if (
            dependent.dependencies.some((key) => cleared.has(key)) &&
            !cleared.has(dependent.key)
          ) {
            next[dependent.key] = dependent.multiple ? [] : null;
            cleared.add(dependent.key);
          }
      if (equal(field.value, value)) delete next[field.key];
      return next;
    });
  }
  function mutation(): SdpMutation {
    if (mode !== 'edit') {
      const addresses = (s: string) =>
        s
          .split(/[,;\n]/)
          .map((v) => v.trim())
          .filter(Boolean);
      return SdpMutationSchema.parse({
        kind: mode === 'forward' ? 'forward' : 'reply',
        ...(mode === 'forward' && sourceId ? { sourceId } : {}),
        id: ticket.id,
        ...mail,
        to: addresses(mail.to),
        cc: addresses(mail.cc),
        bcc: addresses(mail.bcc),
      });
    }
    for (const field of form?.fields ?? []) {
      const value = field.key in patch ? (patch[field.key] ?? null) : field.value;
      if (
        !field.readOnly &&
        field.required &&
        (value === null || value === '' || (Array.isArray(value) && !value.length))
      )
        throw new Error(`${field.label} is required by this template.`);
    }
    return SdpMutationSchema.parse({ kind: 'edit', id: ticket.id, fields: patch });
  }
  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await globalThis.api!.sdpAccount!({
        action: 'prepareChange',
        mutation: mutation(),
      });
      if (!result.success || !result.data?.review)
        throw new Error(
          'Could not prepare this change. Refresh the ticket and check your SDP permissions.',
        );
      if (alive.current) setReview(result.data.review);
    } catch (error) {
      if (alive.current)
        setMessage(
          error instanceof Error && !('issues' in error)
            ? error.message
            : 'Check required fields, email addresses and message length.',
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    if (lock.current || !review) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data)
        throw new Error('SdpNativeEditor: SDP operation did not return the expected result.');
      if (alive.current) {
        setMessage(result.data.message ?? 'Check SDP for the result.');
        onResult(result.data);
      }
    } catch {
      if (alive.current)
        setMessage(
          'The result is uncertain. Check SDP before trying again. Relay will not retry automatically.',
        );
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setFinished(true);
      }
    }
  }
  function close() {
    if (!finished && (Object.keys(patch).length || mail.body) && !discard) {
      setDiscard(true);
      return;
    }
    void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
    onClose();
  }
  const reviewFields =
    mode === 'edit'
      ? Object.entries(patch).map(([key, value]) => [
          form?.fields.find((f) => f.key === key)?.label ?? key,
          fieldLabel(value),
        ])
      : [
          ['To', mail.to],
          ['Cc', mail.cc],
          ['Bcc', mail.bcc],
          ['Subject', mail.subject],
          ['Message', mail.body],
          ['Visible to requester', mail.isPublic ? 'Yes' : 'No'],
        ];
  return (
    <section className="sdp-native-editor" aria-label={editorLabels[mode]}>
      <div className="sdp-editor-heading">
        <div>
          <h3>{editorTitles[mode]}</h3>
          {form && <p>{form.template.name}</p>}
        </div>
        <TactileButton size="sm" variant="ghost" disabled={busy} onClick={close}>
          {discard ? 'Discard draft' : 'Cancel'}
        </TactileButton>
      </div>
      {discard && (
        <p role="alert">
          This draft has not been saved. Choose Discard draft to close, or continue editing.
        </p>
      )}
      {message && (
        <p>
          <output>{message}</output>
        </p>
      )}
      {form?.metadataAvailable === false && (
        <p>
          <output>
            Reconnect your SDP account and allow read-only setup access to load custom field names,
            types and limits. Your existing ticket permissions still apply.
          </output>
        </p>
      )}
      {!!form?.unavailableFields?.length && (
        <p>
          <output>
            These custom fields require SDP because their types are unavailable:{' '}
            {form.unavailableFields.join(', ')}.
          </output>
        </p>
      )}
      {busy && !ready && (
        <p>
          <output>Loading the SDP form…</output>
        </p>
      )}
      {finished && <TactileButton onClick={onClose}>Done</TactileButton>}
      {!finished && review && (
        <section aria-label="Review SDP change" className="sdp-change-review">
          <h4>{mode !== 'edit' ? 'Review email before sending' : 'Review changes'}</h4>
          <p>
            {mode !== 'edit'
              ? 'This sends a real email through SDP to the recipients below.'
              : 'These changes will be saved to SDP using your work account. SDP workflows may send notifications.'}
          </p>
          <dl className="ticket-metadata">
            {reviewFields
              .filter(([, v]) => v)
              .map(([key, v]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          <div className="ticket-actions">
            <TactileButton
              disabled={busy}
              onClick={() => {
                setReview(undefined);
                void globalThis.api?.sdpAccount?.({ action: 'cancelChange' });
              }}
            >
              Back to editing
            </TactileButton>
            <TactileButton variant="primary" loading={busy} onClick={() => void confirm()}>
              {mode !== 'edit' ? 'Confirm and send' : 'Confirm live change'}
            </TactileButton>
          </div>
        </section>
      )}
      {!finished && !review && ready && (
        <>
          {mode === 'edit' && form ? (
            <SdpEditFields form={form} patch={patch} change={change} busy={busy} id={ticket.id} />
          ) : (
            <div className="ticket-form-grid">
              {(['to', 'cc', 'bcc', 'subject'] as const).map((key) => (
                <label key={key} className="ticket-form-wide">
                  {{ to: 'To', cc: 'Cc', bcc: 'Bcc', subject: 'Subject' }[key]}
                  <input
                    value={mail[key]}
                    maxLength={key === 'subject' ? 250 : 12000}
                    onChange={(e) => setMail({ ...mail, [key]: e.target.value })}
                  />
                </label>
              ))}
              <label className="ticket-form-wide">
                <span>Message</span>
                <textarea
                  rows={9}
                  maxLength={12000}
                  value={mail.body}
                  onChange={(e) => setMail({ ...mail, body: e.target.value })}
                />
              </label>
              <label className="ticket-form-checkbox ticket-form-wide">
                <input
                  type="checkbox"
                  checked={mail.isPublic}
                  onChange={(e) => setMail({ ...mail, isPublic: e.target.checked })}
                />
                <span>Show this email to the requester</span>
              </label>
            </div>
          )}
          <div className="sdp-editor-footer">
            <span>
              {mode === 'edit'
                ? `${Object.keys(patch).length} changed fields`
                : 'Recipients and message are reviewed before sending'}
            </span>
            <TactileButton
              variant="primary"
              loading={busy}
              disabled={mode === 'edit' && !Object.keys(patch).length}
              onClick={() => void prepare()}
            >
              {mode !== 'edit' ? 'Review email' : 'Review changes'}
            </TactileButton>
          </div>
        </>
      )}
    </section>
  );
}
function SdpEditFields({
  form,
  patch,
  change,
  busy,
  id,
}: Readonly<{
  form: SdpForm;
  patch: Record<string, SdpFieldValue>;
  change: (f: SdpFormField, v: SdpFieldValue) => void;
  busy: boolean;
  id: string;
}>) {
  return (
    <div className="sdp-template-sections">
      {[...new Set(form.fields.map((f) => f.section))].map((section) => (
        <fieldset key={section}>
          <legend>{section}</legend>
          <div className="ticket-form-grid">
            {form.fields
              .filter((f) => f.section === section)
              .map((field) => (
                <SdpNativeField
                  key={field.key}
                  field={field}
                  id={id}
                  value={field.key in patch ? (patch[field.key] ?? null) : field.value}
                  values={Object.fromEntries(
                    form.fields.map((f) => [
                      f.key,
                      f.key in patch ? (patch[f.key] ?? null) : f.value,
                    ]),
                  )}
                  disabled={busy}
                  onChange={(v) => change(field, v)}
                />
              ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
function SdpNativeField({
  id,
  field,
  value,
  values,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  field: SdpFormField;
  value: SdpFieldValue;
  values: Record<string, SdpFieldValue>;
  disabled: boolean;
  onChange: (v: SdpFieldValue) => void;
}>) {
  const [options, setOptions] = useState(field.choices);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const loaded = useRef(false);
  const dependencies = JSON.stringify(
    Object.fromEntries(field.dependencies.map((key) => [key, values[key] ?? null])),
  );
  useEffect(() => {
    const generation = ++epoch.current;
    loaded.current = false;
    setLoading(false);
    setOptions(field.choices);
    setPage(0);
    setMore(false);
    return () => {
      epoch.current = generation + 1;
    };
  }, [dependencies, field.choices]);
  async function load(next = 0) {
    if (loading) return;
    const current = ++epoch.current;
    setLoading(true);
    setError('');
    try {
      const result = await globalThis.api!.sdpAccount!({
        action: 'readOptions',
        id,
        field: field.key,
        search,
        page: next,
        dependencies: JSON.parse(dependencies) as Record<string, SdpFieldValue>,
      });
      if (!result.success || !result.data?.options)
        throw new Error('SdpNativeEditor: SDP operation did not return the expected result.');
      if (epoch.current === current) {
        setOptions((old) =>
          next ? [...old, ...result.data!.options!.choices] : result.data!.options!.choices,
        );
        setMore(result.data.options.hasMore);
        setPage(next);
        loaded.current = true;
      }
    } catch {
      if (epoch.current === current) setError('Choices unavailable. Try again.');
    } finally {
      if (epoch.current === current) setLoading(false);
    }
  }
  const choice = field.kind === 'lookup' || field.kind === 'choice';
  const locked = disabled || field.readOnly;
  let selected: Exclude<SdpFieldValue, null | unknown[]>[] = [];
  if (Array.isArray(value)) selected = value;
  else if (value !== null) selected = [value];
  const keyOf = (v: Exclude<SdpFieldValue, unknown[]>) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? v.id : String(v ?? '');
  const choices = [...options];
  for (const current of selected)
    if (!choices.some((c) => keyOf(c.value) === keyOf(current)))
      choices.unshift({ label: fieldLabel(current), value: current });
  function selectChange(e: import('react').ChangeEvent<HTMLSelectElement>) {
    const found = Array.from(e.target.selectedOptions)
      .map((o) => choices.find((c) => keyOf(c.value) === o.value)?.value)
      .filter((v): v is NonNullable<typeof v> => v !== undefined);
    onChange(field.multiple ? found : (found[0] ?? null));
  }
  function renderSelect() {
    return (
      <select
        aria-label={field.label}
        multiple={field.multiple}
        disabled={locked || loading}
        value={field.multiple ? selected.map(keyOf) : keyOf(selected[0] ?? null)}
        onFocus={() => {
          if (!field.choices.length && !loaded.current) void load();
        }}
        onChange={selectChange}
      >
        {!field.multiple && <option value="">Not set</option>}
        {choices.map((c) => (
          <option key={keyOf(c.value)} value={keyOf(c.value)}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div
      className={
        field.kind === 'multiline' ? 'ticket-form-wide sdp-native-field' : 'sdp-native-field'
      }
    >
      <label>
        {field.label}
        {field.required ? ' *' : ''}
        {choice ? (
          renderSelect()
        ) : (
          <SdpScalarInput field={field} value={value} disabled={locked} onChange={onChange} />
        )}
      </label>
      {choice && !field.choices.length && !field.readOnly && (
        <div className="sdp-lookup-search">
          <input
            aria-label={`Search ${field.label} choices`}
            placeholder={`Find ${field.label.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void load();
              }
            }}
          />
          <TactileButton
            size="sm"
            loading={loading}
            disabled={disabled}
            onClick={() => void load()}
          >
            Search
          </TactileButton>
          {more && (
            <TactileButton
              size="sm"
              variant="ghost"
              disabled={loading || disabled}
              onClick={() => void load(page + 1)}
            >
              More
            </TactileButton>
          )}
        </div>
      )}
      {error && (
        <small>
          <output>{error}</output>
        </small>
      )}
    </div>
  );
}

function SdpScalarInput({
  field,
  value,
  disabled,
  onChange,
}: Readonly<{
  field: SdpFormField;
  value: SdpFieldValue;
  disabled: boolean;
  onChange: (v: SdpFieldValue) => void;
}>) {
  if (field.kind === 'boolean')
    return (
      <input
        aria-label={field.label}
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (field.kind === 'multiline')
    return (
      <textarea
        aria-label={field.label}
        disabled={disabled}
        rows={5}
        maxLength={field.maxLength}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  if (field.kind === 'date')
    return (
      <input
        aria-label={field.label}
        type={field.dateOnly ? 'date' : 'datetime-local'}
        disabled={disabled}
        value={dateInputValue(value, field.dateOnly)}
        onChange={(e) => {
          const text = e.target.value;
          if (!text) onChange(null);
          else onChange(field.dateOnly ? text : new Date(text).getTime());
        }}
      />
    );
  function change(text: string) {
    if (!text) onChange(null);
    else onChange(field.kind === 'number' ? Number(text) : text);
  }
  return (
    <input
      aria-label={field.label}
      disabled={disabled}
      type={field.kind === 'number' ? 'number' : 'text'}
      step={field.integer ? '1' : 'any'}
      minLength={field.minLength}
      maxLength={field.maxLength}
      value={fieldLabel(value)}
      onChange={(e) => change(e.target.value)}
    />
  );
}

function dateInputValue(value: SdpFieldValue, dateOnly?: boolean): string {
  if (dateOnly && typeof value === 'string') return value;
  if (typeof value !== 'number') return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
