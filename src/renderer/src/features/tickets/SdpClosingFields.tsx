import { useEffect, useState } from 'react';
import type { SdpForm, SdpFormField, SdpFieldValue } from '@shared/sdpForm';
import { emptyValue, patchField, readEditor, SdpNativeField } from './SdpNativeEditor';

/** Fields the close itself fills: its status, and the resolution typed beside these fields. */
const SUPPLIED = new Set(['status', 'resolution', 'resolution.content']);
const valueOf = (field: SdpFormField, patch: Readonly<Record<string, SdpFieldValue>>) =>
  field.key in patch ? (patch[field.key] ?? null) : field.value;

/**
 * The required SDP fields a ticket leaves empty. SDP refuses to close or resolve the ticket until
 * they are filled, so the close asks for them with SDP's own choices. A form SDP does not describe
 * asks for nothing here; SDP still reports any field it rejects.
 */
export function useSdpClosingFields(id: string | undefined) {
  const [form, setForm] = useState<SdpForm>();
  // Fixed when the form loads, so a field stays in view while it is filled in.
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [patch, setPatch] = useState<Record<string, SdpFieldValue>>({});
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
  const fields = (form?.fields ?? []).filter((f) => keys.includes(f.key));
  return {
    form,
    fields,
    loading,
    patch,
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
  const { form, fields, loading, patch, change } = closing;
  if (loading)
    return (
      <p className="ticket-form-wide">
        <output>Checking the fields SDP requires to close this ticket…</output>
      </p>
    );
  if (!form || !fields.length) return null;
  const values = Object.fromEntries(form.fields.map((f) => [f.key, valueOf(f, patch)]));
  return (
    <fieldset className="ticket-form-wide sdp-closing-fields">
      <legend>Required by SDP to close</legend>
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
