import { useEffect, useId, useState } from 'react';
import type { SdpResourceChoices } from '@shared/sdpResources';
import { TactileButton } from '../../components/TactileButton';
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
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SdpResourceChoices>();
  const [error, setError] = useState('');
  // A load failure is not an invalid value, so the controls are described by it, not marked invalid.
  const errorId = useId();
  const errorDescription = error ? errorId : undefined;
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError('');
    void globalThis.api!.sdpAccount!({ action: 'readResourceChoices', id, catalog, search, page })
      .then((result) => {
        if (!active) return;
        if (result.success && result.data?.resourceChoices) setData(result.data.resourceChoices);
        else setError('Choices are unavailable. Check your SDP permissions.');
      })
      .catch(() => {
        if (active) setError('Choices could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [id, catalog, search, page]);
  return (
    <span className="sdp-checklist-choice">
      <input
        aria-label={`Search ${label.toLowerCase()}`}
        aria-describedby={errorDescription}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        maxLength={200}
      />
      <TactileButton
        size="sm"
        onClick={() => {
          setSearch(query.trim());
          setPage(0);
        }}
      >
        Search Choices
      </TactileButton>
      <select
        aria-label={label}
        aria-describedby={errorDescription}
        value={value}
        disabled={!data}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {value && !data?.choices.some((c) => c.id === value) && (
          <option value={value}>Current selection</option>
        )}
        {data?.choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
      <TactileButton size="sm" disabled={!data || page === 0} onClick={() => setPage(page - 1)}>
        Previous Choices
      </TactileButton>
      <TactileButton
        size="sm"
        disabled={!data?.hasMore || page >= 99}
        onClick={() => setPage(page + 1)}
      >
        More Choices
      </TactileButton>
    </span>
  );
}
