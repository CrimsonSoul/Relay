import { useEffect, useId, useState } from 'react';
import { SDP_SERVER_UPDATE_MESSAGE } from '@shared/sdpAccount';
import type { SdpMutation } from '@shared/sdpMutation';
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
function standardLeading(value: string, allowUnassign = false) {
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

/**
 * Prepares a change. A Relay server that predates SDP IDs (`fieldIds`) refuses them before
 * anything is prepared, so the same change is prepared again by name, as those servers sent it.
 */
export async function prepareSdpChange(mutation: SdpMutation) {
  const prepared = await globalThis.api!.sdpAccount!({ action: 'prepareChange', mutation });
  if (
    prepared.success ||
    prepared.error !== SDP_SERVER_UPDATE_MESSAGE ||
    !('fieldIds' in mutation && mutation.fieldIds)
  )
    return prepared;
  const byName = Object.fromEntries(
    Object.entries(mutation).filter(([key]) => key !== 'fieldIds'),
  ) as SdpMutation;
  return globalThis.api!.sdpAccount!({ action: 'prepareChange', mutation: byName });
}

/**
 * SDP IDs for values a form fills in itself (Close Ticket's Closed status, a major incident's
 * defaults), looked up once by exact name. A value SDP does not list keeps no ID and is sent by
 * name.
 */
export function useStandardIds(defaults: Readonly<Record<string, string>>): Record<string, string> {
  const [ids, setIds] = useState<Record<string, string>>({});
  const key = JSON.stringify(defaults);
  useEffect(() => {
    let current = true;
    for (const [field, value] of Object.entries(JSON.parse(key) as Record<string, string>)) {
      const standard = standardFieldKey(field);
      if (!standard) continue;
      void standardChoiceLoader(standard)(value, 0)
        .then(({ choices }) => {
          const match = choices.find((c) => c.key.toLowerCase() === value.toLowerCase());
          if (current && match?.value) setIds((old) => ({ ...old, [field]: match.value! }));
        })
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [key]);
  return ids;
}
