import { useEffect, useRef, useState } from 'react';
import type { SdpOptionsSchema, SdpStandardOptionsCommand } from '@shared/sdpForm';
import type { z } from 'zod';
import { TactileButton } from '../../components/TactileButton';

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

export function SdpStandardSelect({
  field,
  label,
  value,
  groupId,
  disabled,
  allowUnassign,
  onChange,
}: Readonly<{
  field: SdpStandardOptionsCommand['field'];
  label: string;
  value: string;
  groupId?: string;
  disabled?: boolean;
  allowUnassign?: boolean;
  onChange: (name: string, id?: string) => void;
}>) {
  const [options, setOptions] = useState<Choice[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loaded = useRef(false);
  const epoch = useRef(0);
  const pending = useRef(false);
  const dependency = field === 'technician' ? groupId : undefined;
  useEffect(() => {
    const version = epoch;
    ++version.current;
    loaded.current = false;
    pending.current = false;
    setOptions([]);
    setSearch('');
    setPage(0);
    setMore(false);
    setLoading(false);
    setError('');
    return () => {
      ++version.current;
    };
  }, [field, dependency]);
  async function load(next = 0) {
    if (pending.current || disabled) return;
    const current = ++epoch.current;
    pending.current = true;
    setLoading(true);
    setError('');
    try {
      const result = await globalThis.api!.sdpAccount!({
        action: 'readStandardOptions',
        field,
        search,
        page: next,
        ...(field === 'technician' && groupId ? { groupId } : {}),
      });
      if (!result.success || result.data?.options?.field !== field)
        throw new Error('SdpStandardSelect: SDP operation did not return the expected result.');
      if (current !== epoch.current) return;
      const incoming = result.data.options;
      setOptions((old) => (next ? [...old, ...incoming.choices] : incoming.choices));
      setMore(incoming.hasMore);
      setPage(next);
      loaded.current = true;
    } catch {
      if (current === epoch.current) setError('Choices unavailable. Search to try again.');
    } finally {
      if (current === epoch.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  }
  const names = [...new Set(options.map(name))];
  return (
    <div className="sdp-native-field">
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={disabled || loading}
          onFocus={() => {
            if (!loaded.current) void load();
          }}
          onChange={(e) => {
            const selected = options.find((c) => name(c) === e.target.value);
            onChange(
              e.target.value,
              selected && typeof selected.value === 'object' ? selected.value.id : undefined,
            );
          }}
        >
          <option value="">Choose…</option>
          {allowUnassign && <option value="(Unassigned)">Unassigned</option>}
          {value && value !== '(Unassigned)' && !names.includes(value) && (
            <option value={value}>{value}</option>
          )}
          {names.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div className="sdp-lookup-search">
        <input
          aria-label={`Search ${label} choices`}
          placeholder={`Find ${label.toLowerCase()}…`}
          value={search}
          disabled={disabled || loading}
          maxLength={200}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void load();
            }
          }}
        />
        <TactileButton size="sm" disabled={disabled || loading} onClick={() => void load()}>
          Search
        </TactileButton>
        {more && (
          <TactileButton
            size="sm"
            disabled={disabled || loading}
            onClick={() => void load(page + 1)}
          >
            More
          </TactileButton>
        )}
      </div>
      {loading && (
        <p>
          <output>Loading choices…</output>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
