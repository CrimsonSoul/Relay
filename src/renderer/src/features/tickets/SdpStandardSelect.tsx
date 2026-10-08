import { useId } from 'react';
import type { SdpOptionsSchema, SdpStandardOptionsCommand } from '@shared/sdpForm';
import type { z } from 'zod';
import { SdpChoicePicker, type SdpChoiceLoader } from './SdpChoicePicker';

const fieldKeys: Record<string, SdpStandardOptionsCommand['field']> = {
  group: 'group',
  technician: 'technician',
  status: 'status',
  priority: 'priority',
  requestType: 'request_type',
  category: 'category',
  impact: 'impact',
  urgency: 'urgency',
};
export const standardFieldKey = (field: string) => fieldKeys[field];
type Choice = z.infer<typeof SdpOptionsSchema>['choices'][number];
function name(choice: Choice): string {
  return typeof choice.value === 'object'
    ? (choice.value.name ?? choice.label)
    : String(choice.value);
}

/** Reads one standard ticket field's choices from SDP, one name each; technicians follow a group. */
export function standardChoiceLoader(
  field: SdpStandardOptionsCommand['field'],
  groupId?: string,
): SdpChoiceLoader<string | undefined> {
  return async (search, page) => {
    const result = await globalThis.api!.sdpAccount!({
      action: 'readStandardOptions',
      field,
      search,
      page,
      ...(field === 'technician' && groupId ? { groupId } : {}),
    });
    if (!result.success || result.data?.options?.field !== field)
      throw new Error('SdpStandardSelect: SDP operation did not return the expected result.');
    const { choices, hasMore } = result.data.options;
    return {
      choices: choices.map((choice) => ({
        key: name(choice),
        label: name(choice),
        value: typeof choice.value === 'object' ? choice.value.id : undefined,
      })),
      hasMore,
    };
  };
}
const UNASSIGNED = { key: '(Unassigned)', label: 'Unassigned', value: undefined } as const;
/** Choices before SDP's list: clearing a chosen value, and Unassigned where SDP allows it. */
export function standardLeading(value: string, allowUnassign = false) {
  return [
    ...(value ? [{ key: '', label: 'Clear choice', value: undefined }] : []),
    ...(allowUnassign ? [UNASSIGNED] : []),
  ];
}

export function SdpStandardSelect({
  field,
  label,
  value,
  groupId,
  disabled,
  allowUnassign,
  required = false,
  onChange,
}: Readonly<{
  field: SdpStandardOptionsCommand['field'];
  label: string;
  value: string;
  groupId?: string;
  disabled?: boolean;
  allowUnassign?: boolean;
  /** Marks the label; the picker keeps the plain label as its name. */
  required?: boolean;
  onChange: (name: string, id?: string) => void;
}>) {
  const pickerId = useId();
  const dependency = field === 'technician' ? (groupId ?? '') : '';
  return (
    <div className="sdp-native-field sdp-choice-field">
      <label htmlFor={pickerId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <SdpChoicePicker
        id={pickerId}
        label={label}
        required={required}
        selected={[value]}
        display={value === UNASSIGNED.key ? UNASSIGNED.label : value}
        placeholder="Choose…"
        load={standardChoiceLoader(field, groupId)}
        resetKey={`${field}:${dependency}`}
        leading={standardLeading(value, allowUnassign)}
        disabled={disabled}
        onSelect={(choice) => onChange(choice.key, choice.value)}
      />
    </div>
  );
}
