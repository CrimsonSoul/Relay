import { useState } from 'react';
import type { SdpResourceChoices } from '@shared/sdpResources';
import { SdpChoicePicker, type SdpChoiceLoader } from './SdpChoicePicker';

// SDP serves at most 100 pages of a catalog.
const LAST_PAGE = 99;

export function SdpChecklistChoice({
  id,
  catalog,
  label,
  value,
  onChange,
}: Readonly<{
  id: string;
  catalog: SdpResourceChoices['catalog'];
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  // The chosen name; a value set before this dialog opened is named generically.
  const [name, setName] = useState('');
  const load: SdpChoiceLoader<string> = async (search, page) => {
    const result = await globalThis.api!.sdpAccount!({
      action: 'readResourceChoices',
      id,
      catalog,
      search,
      page,
    });
    if (!result.success || !result.data?.resourceChoices)
      throw new Error('SdpChecklistChoice: SDP operation did not return the expected result.');
    const { choices, hasMore } = result.data.resourceChoices;
    return {
      choices: choices.map((choice) => ({ key: choice.id, label: choice.name, value: choice.id })),
      hasMore: hasMore && page < LAST_PAGE,
    };
  };
  return (
    <SdpChoicePicker
      label={label}
      selected={[value]}
      display={value ? name || 'Current selection' : ''}
      placeholder="Choose…"
      load={load}
      resetKey={`${id}:${catalog}`}
      leading={value ? [{ key: '', label: 'Clear choice', value: '' }] : []}
      onSelect={(choice) => {
        setName(choice.key ? choice.label : '');
        onChange(choice.value);
      }}
    />
  );
}
