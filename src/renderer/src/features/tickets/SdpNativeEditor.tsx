import { useEffect, useId, useRef, useState } from 'react';
import type { BridgeAPI } from '@shared/ipc';
import type { SdpAccountView, SdpQueueTicket } from '@shared/sdpAccount';
import { SdpMutationSchema, type SdpMutation, type SdpReview } from '@shared/sdpMutation';
import type { SdpForm, SdpFormField, SdpFieldValue } from '@shared/sdpForm';
import { TactileButton } from '../../components/TactileButton';
import { SdpMessage, sdpError, sdpInfo, type SdpNotice } from './SdpMessage';
import { SdpChoicePicker } from './SdpChoicePicker';

export const fieldLabel = (value: SdpFieldValue): string => {
  if (value === null) return 'Not set';
  if (Array.isArray(value)) return value.map(fieldLabel).join(', ');
  if (typeof value === 'object') return value.name || value.id;
  return String(value);
};
const equal = (a: SdpFieldValue, b: SdpFieldValue) => JSON.stringify(a) === JSON.stringify(b);
/** The edit footer's summary: what Review Changes will send, named by field. */
export function changeSummary(labels: readonly string[]): string {
  if (!labels.length) return 'No changes yet';
  const rest = labels.length > 3 ? ` and ${labels.length - 3} more` : '';
  return `${labels.length} ${labels.length === 1 ? 'change' : 'changes'}: ${labels.slice(0, 3).join(', ')}${rest}`;
}
/** Sets one field in a draft. A changed parent invalidates dependent selections, including grandchildren. */
export function patchField(
  form: SdpForm | undefined,
  previous: Readonly<Record<string, SdpFieldValue>>,
  field: SdpFormField,
  value: SdpFieldValue,
): Record<string, SdpFieldValue> {
  const next = { ...previous, [field.key]: value };
  const cleared = new Set([field.key]);
  for (let i = 0; i < 3; i++)
    for (const dependent of form?.fields ?? [])
      if (dependent.dependencies.some((key) => cleared.has(key)) && !cleared.has(dependent.key)) {
        next[dependent.key] = dependent.multiple ? [] : null;
        cleared.add(dependent.key);
      }
  if (equal(field.value, value)) delete next[field.key];
  return next;
}
function plain(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll('script,style,iframe,object')) node.remove();
  for (const node of template.content.querySelectorAll('br')) node.replaceWith('\n');
  for (const node of template.content.querySelectorAll('p,div,li,tr')) node.append('\n');
  return template.content.textContent?.trim() ?? '';
}
type EditorRead = {
  action: (typeof editorCommands)[keyof typeof editorCommands];
  id: string;
  sourceId?: string;
};
const editorReads = new Map<string, ReturnType<NonNullable<BridgeAPI['sdpAccount']>>>();
/**
 * The broker runs one SDP read at a time, and development mode replays every effect, so an
 * identical load already in flight is shared rather than sent again (and refused).
 */
function readEditor(command: EditorRead) {
  const key = JSON.stringify(command);
  const pending = editorReads.get(key);
  if (pending) return pending;
  const read = globalThis.api!.sdpAccount!(command).finally(() => editorReads.delete(key));
  editorReads.set(key, read);
  return read;
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
  quote,
  withCc = true,
  mode,
  onClose,
  onResult,
}: Readonly<{
  ticket: SdpQueueTicket;
  mode: 'edit' | 'reply' | 'forward';
  sourceId?: string;
  /** A reply to one message starts with that message quoted beneath the reply. */
  quote?: string;
  /** Reply leaves the ticket's CC list out; Reply All and a ticket reply keep it. */
  withCc?: boolean;
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
  const [message, setMessage] = useState<SdpNotice>();
  const [finished, setFinished] = useState(false);
  const [discard, setDiscard] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    setBusy(true);
    void readEditor({
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
          let body = quote ? `\n\n${quote}` : '';
          if (c.body) body = plain(c.body);
          setMail((m) => ({
            ...m,
            to: c.to.join(', '),
            cc: withCc ? c.cc.join(', ') : '',
            subject: c.subject,
            body,
            isPublic: mode !== 'forward',
          }));
          setReady(c.canReply);
        } else {
          setMessage(sdpError(result.data?.message ?? 'SDP did not return the ticket form.'));
        }
      })
      .catch(() => {
        if (alive.current)
          setMessage(
            sdpError(
              'The form is unavailable. Check your connection and SDP permissions, then reopen it.',
            ),
          );
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
    };
  }, [ticket.id, mode, sourceId, quote, withCc]);
  function change(field: SdpFormField, value: SdpFieldValue) {
    setPatch((previous) => patchField(form, previous, field, value));
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
      if (!field.readOnly && field.required && emptyValue(value))
        throw new Error(`${field.label} is required by this template.`);
    }
    return SdpMutationSchema.parse({ kind: 'edit', id: ticket.id, fields: patch });
  }
  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
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
          sdpError(
            error instanceof Error && !('issues' in error)
              ? error.message
              : 'Check required fields, email addresses and message length.',
          ),
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
    setMessage(undefined);
    const confirmationId = review.confirmationId;
    setReview(undefined);
    try {
      const result = await globalThis.api!.sdpAccount!({ action: 'confirmChange', confirmationId });
      if (!result.success || !result.data)
        throw new Error('SdpNativeEditor: SDP operation did not return the expected result.');
      if (alive.current) {
        setMessage(sdpInfo(result.data.message ?? 'Check SDP for the result.'));
        onResult(result.data);
      }
    } catch {
      if (alive.current)
        setMessage(
          sdpError(
            'The result is uncertain. Check SDP before trying again. Relay will not retry automatically.',
          ),
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
  const composing = !finished && !review && ready;
  // Cancel matches the dialogs' footer Cancel; Discard Draft loses text, so it is the danger outline.
  const closeButton = (size: 'sm' | 'md') => (
    <TactileButton
      size={size}
      variant={discard ? 'danger' : 'secondary'}
      disabled={busy}
      onClick={close}
    >
      {discard ? 'Discard Draft' : 'Cancel'}
    </TactileButton>
  );
  const discardWarning = discard && (
    <p className="field-error" role="alert">
      This draft has not been saved. Choose Discard Draft to close, or continue editing.
    </p>
  );
  const changed = Object.keys(patch).map(
    (key) => form?.fields.find((f) => f.key === key)?.label ?? key,
  );
  // The fields scroll between a fixed heading and footer, so nothing passes beneath the buttons.
  return (
    <section className="sdp-native-editor" aria-label={editorLabels[mode]}>
      <div className="sdp-editor-heading">
        <div>
          <h3>{editorTitles[mode]}</h3>
          {form && <p>{form.template.name}</p>}
        </div>
        {!composing && !finished && closeButton('sm')}
      </div>
      <div className="sdp-editor-body">
        {!composing && discardWarning}
        <SdpMessage message={message} />
        {form?.metadataAvailable === false && (
          <p className="sdp-editor-note">
            <output>
              Custom field names, types and limits need read-only setup access. Reconnect your SDP
              account to allow it; your ticket permissions stay the same.
            </output>
          </p>
        )}
        {!!form?.unavailableFields?.length && (
          <p className="sdp-editor-note">
            <output>
              Edit these custom fields in SDP; their types are unavailable:{' '}
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
                Back to Editing
              </TactileButton>
              <TactileButton variant="primary" loading={busy} onClick={() => void confirm()}>
                {mode !== 'edit' ? 'Confirm and Send' : 'Save'}
              </TactileButton>
            </div>
          </section>
        )}
        {composing &&
          (mode === 'edit' && form ? (
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
          ))}
      </div>
      {composing && (
        <div className="sdp-editor-footer">
          {discardWarning}
          <span>
            {mode === 'edit'
              ? changeSummary(changed)
              : 'Recipients and message are reviewed before sending'}
          </span>
          {closeButton('md')}
          <TactileButton
            variant="primary"
            loading={busy}
            disabled={mode === 'edit' && !changed.length}
            onClick={() => void prepare()}
          >
            {mode !== 'edit' ? 'Review Email' : 'Review Changes'}
          </TactileButton>
        </div>
      )}
    </section>
  );
}
/**
 * A custom field SDP lists without a display name shows its internal name (such as udf_char110);
 * an optional, empty one is left out of the editor, as SDP's own form leaves it out.
 */
function unnamedField(field: SdpFormField): boolean {
  if (!field.key.startsWith('udf_fields.')) return false;
  const label = field.label.trim().toLowerCase();
  return label === field.key.toLowerCase() || label === field.key.slice(11).toLowerCase();
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
  const [showEmpty, setShowEmpty] = useState(false);
  const current = (f: SdpFormField) => (f.key in patch ? (patch[f.key] ?? null) : f.value);
  const shown = form.fields.filter(
    (f) => !unnamedField(f) || f.required || !emptyValue(f.value) || f.key in patch,
  );
  const sections = [...new Set(shown.map((f) => f.section))].map((name) => ({
    name,
    fields: shown.filter((f) => f.section === name),
  }));
  // SDP's form rules reveal sections such as Workday or Facilities details only when they apply.
  // Relay cannot evaluate those rules, so sections of optional, empty custom fields start folded.
  const empty = sections.filter((section) =>
    section.fields.every(
      (f) => f.key.startsWith('udf_fields.') && !f.required && emptyValue(current(f)),
    ),
  );
  const plural = empty.length === 1 ? 'Section' : 'Sections';
  const foldLabel = showEmpty
    ? 'Hide Empty Custom Sections'
    : `Show ${empty.length} Empty Custom ${plural}`;
  return (
    <div className="sdp-template-sections">
      {sections
        .filter((section) => showEmpty || !empty.includes(section))
        .map(({ name: section, fields }) => (
          <fieldset key={section}>
            <legend>{section}</legend>
            <div className="ticket-form-grid">
              {fields.map((field) => (
                <div
                  key={field.key}
                  className={[
                    'sdp-edit-field',
                    field.kind === 'multiline' ? 'ticket-form-wide' : '',
                    field.key in patch ? 'is-changed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <SdpNativeField
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
                  {field.key in patch && (
                    <FieldChange
                      field={field}
                      busy={busy}
                      onUndo={() => change(field, field.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      {empty.length > 0 && (
        <div className="sdp-empty-sections">
          <TactileButton
            size="sm"
            variant="ghost"
            aria-expanded={showEmpty}
            onClick={() => setShowEmpty(!showEmpty)}
          >
            {foldLabel}
          </TactileButton>
          {!showEmpty && <span>{empty.map((section) => section.name).join(', ')}</span>}
        </div>
      )}
    </div>
  );
}
/** A changed field's previous value, with Undo to restore it before review. */
function FieldChange({
  field,
  busy,
  onUndo,
}: Readonly<{ field: SdpFormField; busy: boolean; onUndo: () => void }>) {
  const was = emptyValue(field.value) ? '' : fieldLabel(field.value);
  return (
    <p className="sdp-field-change">
      <span title={was || undefined}>{was ? `Was ${was.split('\n')[0]}` : 'Was empty'}</span>
      <TactileButton
        size="xs"
        variant="ghost"
        aria-label={`Undo ${field.label}`}
        disabled={busy}
        onClick={onUndo}
      >
        Undo
      </TactileButton>
    </p>
  );
}
/** SDP treats null, blank text and an empty selection alike. */
export function emptyValue(value: SdpFieldValue): boolean {
  return value === null || value === '' || (Array.isArray(value) && !value.length);
}
export function SdpNativeField({
  id,
  field,
  value,
  values,
  disabled,
  hideLabel = false,
  autoOpen = false,
  onChange,
}: Readonly<{
  id: string;
  field: SdpFormField;
  value: SdpFieldValue;
  values: Record<string, SdpFieldValue>;
  disabled: boolean;
  /** For a control placed beside its own visible label; the control keeps its accessible name. */
  hideLabel?: boolean;
  /** Opens a choice list straight away, as clicking an SDP field does. */
  autoOpen?: boolean;
  onChange: (v: SdpFieldValue) => void;
}>) {
  const pickerId = useId();
  const choice = field.kind === 'lookup' || field.kind === 'choice';
  const locked = disabled || field.readOnly;
  const selected = selectedValues(value);
  const choices = withSelected(field.choices, selected);
  // SDP Check Box fields (such as Major Incident: one "Yes" option) are short static multi-choice
  // lists; they render as checkboxes rather than a multi-select list.
  if (field.kind === 'choice' && field.multiple && field.choices.length && choices.length <= 12)
    return (
      <SdpCheckList
        field={field}
        choices={choices}
        selected={selected}
        disabled={locked}
        hideLabel={hideLabel}
        onChange={onChange}
      />
    );
  if (field.kind === 'boolean')
    return (
      <div className="sdp-native-field">
        <SdpCheckbox
          label={field.label}
          required={field.required}
          hideLabel={hideLabel}
          checked={value === true}
          disabled={locked}
          onChange={onChange}
        />
      </div>
    );
  const label = !hideLabel && (
    <>
      {field.label}
      {field.required ? ' *' : ''}
    </>
  );
  if (!choice)
    return (
      <div
        className={[field.kind === 'multiline' ? 'ticket-form-wide' : '', 'sdp-native-field']
          .filter(Boolean)
          .join(' ')}
      >
        <label>
          {label}
          <SdpScalarInput field={field} value={value} disabled={locked} onChange={onChange} />
        </label>
      </div>
    );
  return (
    <div className="sdp-native-field sdp-choice-field">
      {label && <label htmlFor={pickerId}>{label}</label>}
      <SdpFieldPicker
        id={id}
        pickerId={pickerId}
        field={field}
        choices={choices}
        selected={selected}
        values={values}
        disabled={locked}
        autoOpen={autoOpen}
        onChange={onChange}
      />
    </div>
  );
}
type PickerValue = Exclude<SdpFieldValue, unknown[]>;
/**
 * A template choice field's picker. Fixed choices filter as the person types; long SDP lookups
 * (such as requesters) search SDP and load more as the list scrolls, following any parent fields.
 */
function SdpFieldPicker({
  id,
  pickerId,
  field,
  choices,
  selected,
  values,
  disabled,
  autoOpen,
  onChange,
}: Readonly<{
  id: string;
  pickerId: string;
  field: SdpFormField;
  choices: SdpFormField['choices'];
  selected: SdpChoiceValue[];
  values: Record<string, SdpFieldValue>;
  disabled: boolean;
  autoOpen: boolean;
  onChange: (v: SdpFieldValue) => void;
}>) {
  const dependencies = JSON.stringify(
    Object.fromEntries(field.dependencies.map((key) => [key, values[key] ?? null])),
  );
  const remote = !field.choices.length;
  const asChoice = (c: { label: string; value: PickerValue }) => ({
    key: keyOf(c.value),
    label: c.label,
    value: c.value,
  });
  async function load(search: string, page: number) {
    const result = await globalThis.api!.sdpAccount!({
      action: 'readOptions',
      id,
      field: field.key,
      search,
      page,
      dependencies: JSON.parse(dependencies) as Record<string, SdpFieldValue>,
    });
    if (!result.success || !result.data?.options)
      throw new Error('SdpNativeEditor: SDP operation did not return the expected result.');
    return {
      choices: result.data.options.choices.map(asChoice),
      hasMore: result.data.options.hasMore,
    };
  }
  const keys = selected.map(keyOf);
  // A multi-select lookup lists its current choices first, so each can be removed again.
  let leading = [{ key: '', label: 'Not set', value: null as PickerValue }];
  if (field.multiple)
    leading = remote ? selected.map((v) => asChoice({ label: fieldLabel(v), value: v })) : [];
  return (
    <SdpChoicePicker<PickerValue>
      id={pickerId}
      label={field.label}
      required={field.required}
      selected={keys}
      display={selected
        .map((v) => choices.find((c) => keyOf(c.value) === keyOf(v))?.label ?? fieldLabel(v))
        .join(', ')}
      placeholder="Not set"
      choices={remote ? undefined : choices.map(asChoice)}
      load={remote ? load : undefined}
      resetKey={dependencies}
      leading={leading}
      multiple={field.multiple}
      disabled={disabled}
      autoOpen={autoOpen}
      onSelect={(picked) => {
        if (!field.multiple) onChange(picked.key ? picked.value : null);
        else if (keys.includes(picked.key))
          onChange(selected.filter((v) => keyOf(v) !== picked.key));
        else if (picked.value !== null) onChange([...selected, picked.value]);
      }}
    />
  );
}
function selectedValues(value: SdpFieldValue): Exclude<SdpFieldValue, null | unknown[]>[] {
  if (Array.isArray(value)) return value;
  return value === null ? [] : [value];
}
/** The loaded choices, led by any current selection SDP did not list (so it stays visible). */
function withSelected(options: SdpFormField['choices'], selected: readonly SdpChoiceValue[]) {
  const choices = [...options];
  for (const current of selected)
    if (!choices.some((c) => keyOf(c.value) === keyOf(current)))
      choices.unshift({ label: fieldLabel(current), value: current });
  return choices;
}
type SdpChoiceValue = Exclude<SdpFieldValue, null | unknown[]>;
const keyOf = (v: Exclude<SdpFieldValue, unknown[]>) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v.id : String(v ?? '');
/** A fixed multi-choice field as checkboxes; one option is a single checkbox named by the field. */
function SdpCheckList({
  field,
  choices,
  selected,
  disabled,
  hideLabel,
  onChange,
}: Readonly<{
  field: SdpFormField;
  choices: SdpFormField['choices'];
  selected: SdpChoiceValue[];
  disabled: boolean;
  hideLabel: boolean;
  onChange: (v: SdpFieldValue) => void;
}>) {
  const isChecked = (option: Exclude<SdpFieldValue, unknown[]>) =>
    selected.some((v) => keyOf(v) === keyOf(option));
  const toggle = (option: Exclude<SdpFieldValue, unknown[]>, checked: boolean) =>
    onChange(
      checked
        ? [...selected, option as SdpChoiceValue]
        : selected.filter((v) => keyOf(v) !== keyOf(option)),
    );
  if (choices.length === 1) {
    const only = choices[0]!.value;
    return (
      <div className="sdp-native-field">
        <SdpCheckbox
          label={field.label}
          required={field.required}
          hideLabel={hideLabel}
          checked={isChecked(only)}
          disabled={disabled}
          onChange={(checked) => toggle(only, checked)}
        />
      </div>
    );
  }
  return (
    <fieldset className="sdp-native-field sdp-native-checks" disabled={disabled}>
      <legend className={hideLabel ? 'sr-only' : undefined}>
        {field.label}
        {field.required ? ' *' : ''}
      </legend>
      {choices.map((c) => (
        <SdpCheckbox
          key={keyOf(c.value)}
          label={c.label}
          checked={isChecked(c.value)}
          disabled={disabled}
          onChange={(checked) => toggle(c.value, checked)}
        />
      ))}
    </fieldset>
  );
}
function SdpCheckbox({
  label,
  required = false,
  hideLabel = false,
  checked,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  required?: boolean;
  hideLabel?: boolean;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <label className="ticket-form-checkbox">
      <input
        type="checkbox"
        aria-label={hideLabel ? label : undefined}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {!hideLabel && (
        <span>
          {label}
          {required ? ' *' : ''}
        </span>
      )}
    </label>
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
      value={value === null ? '' : fieldLabel(value)}
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
