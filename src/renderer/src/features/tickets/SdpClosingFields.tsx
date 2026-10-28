import { useEffect, useState } from 'react';
import type { SdpForm, SdpFormField, SdpFieldValue } from '@shared/sdpForm';
import { emptyValue, patchField, readEditor, SdpNativeField } from './SdpNativeEditor';

/** Fields the close itself fills: its status, and the resolution typed beside these fields. */
const SUPPLIED = new Set(['status', 'resolution', 'resolution.content']);
const valueOf = (field: SdpFormField, patch: Readonly<Record<string, SdpFieldValue>>) =>
  field.key in patch ? (patch[field.key] ?? null) : field.value;
/** SDP names a custom field with or without its `udf_fields.` parent. */
const sameField = (name: string, key: string) =>
  name === key || key.endsWith(`.${name}`) || name.endsWith(`.${key}`);
const supplied = (name: string) => [...SUPPLIED].some((key) => sameField(name, key));
/** A readable name for a field SDP requires that this ticket's form does not show. */
const fieldName = (name: string) => {
  const text = (name.split('.').at(-1) ?? name).replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * The required SDP fields a ticket leaves empty. SDP refuses to close or resolve the ticket until
 * they are filled, so the close asks for them with SDP's own choices. The form marks only the
 * template's required fields; SDP's closing rules name theirs only by rejecting a close, so
 * `ask` adds the fields such a rejection names. A form SDP does not describe asks for nothing.
 */
export function useSdpClosingFields(id: string | undefined, initial: readonly string[] = []) {
  const [form, setForm] = useState<SdpForm>();
  // Fixed when the form loads, so a field stays in view while it is filled in.
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [patch, setPatch] = useState<Record<string, SdpFieldValue>>({});
  // Field names SDP gave when it rejected a close.
  const [asked, setAsked] = useState<readonly string[]>(() => initial.filter((n) => !supplied(n)));
  useEffect(() => {
    if (!id) return;
    let current = true;
    readEditor({ action: 'readForm', id })
      .then((result) => {
        if (!current || !result.success || !result.data?.form) return;
        const loaded = result.data.form;
        setForm(loaded);
        setKeys(
          loaded.fields
            .filter((f) => f.required && !SUPPLIED.has(f.key) && emptyValue(f.value))
            .map((f) => f.key),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [id]);
  const all = form?.fields ?? [];
  const fields = all.filter(
    (f) => keys.includes(f.key) || asked.some((name) => sameField(name, f.key)),
  );
  return {
    form,
    fields,
    loading,
    patch,
    /** Fields SDP requires that this form cannot set; they are filled in SDP itself. */
    elsewhere: form
      ? asked.filter((name) => !all.some((f) => sameField(name, f.key))).map(fieldName)
      : [],
    /**
     * Asks for the fields a rejected close names; returns whether any is new. A field already
     * asked for that SDP rejects again needs SDP's own reason instead.
     */
    ask: (names: readonly string[]) => {
      const added = names.filter(
        (name) =>
          !supplied(name) && !asked.includes(name) && !keys.some((key) => sameField(name, key)),
      );
      setAsked((old) => [...new Set([...old, ...added])]);
      return added.length > 0;
    },
    /** Labels of the required fields still empty. */
    unfilled: fields.filter((f) => emptyValue(valueOf(f, patch))).map((f) => f.label),
    change: (field: SdpFormField, value: SdpFieldValue) =>
      setPatch((previous) => patchField(form, previous, field, value)),
    /** The values are now the ticket's own, so another attempt does not send them again. */
    saved: () => {
      setForm(
        (old) =>
          old && { ...old, fields: old.fields.map((f) => ({ ...f, value: valueOf(f, patch) })) },
      );
      setPatch({});
    },
  };
}
export type SdpClosingFields = ReturnType<typeof useSdpClosingFields>;

export function SdpClosingFieldList({
  closing,
  ticketId,
  disabled,
}: Readonly<{ closing: SdpClosingFields; ticketId: string; disabled: boolean }>) {
  const { form, fields, elsewhere, loading, patch, change } = closing;
  if (loading)
    return (
      <p className="ticket-form-wide">
        <output>Checking the fields SDP requires to close this ticket…</output>
      </p>
    );
  if (!form || (!fields.length && !elsewhere.length)) return null;
  const values = Object.fromEntries(form.fields.map((f) => [f.key, valueOf(f, patch)]));
  return (
    <fieldset className="ticket-form-wide sdp-closing-fields">
      <legend>Required by SDP to close</legend>
      {elsewhere.length > 0 && (
        <p className="sdp-editor-note">
          SDP also requires {elsewhere.join(', ')}, which this ticket&apos;s form does not offer
          here. Set {elsewhere.length > 1 ? 'them' : 'it'} in SDP, then close the ticket.
        </p>
      )}
      <div className="ticket-form-grid">
        {fields.map((field) => (
          <SdpNativeField
            key={field.key}
            id={ticketId}
            field={field}
            value={valueOf(field, patch)}
            values={values}
            disabled={disabled}
            onChange={(v) => change(field, v)}
          />
        ))}
      </div>
    </fieldset>
  );
}
