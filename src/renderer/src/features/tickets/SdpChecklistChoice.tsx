import { useEffect, useState } from 'react';
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
        Search choices
      </TactileButton>
      <select
        aria-label={label}
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
      {error && <span role="alert">{error}</span>}
      <TactileButton size="sm" disabled={!data || page === 0} onClick={() => setPage(page - 1)}>
        Previous choices
      </TactileButton>
      <TactileButton
        size="sm"
        disabled={!data?.hasMore || page >= 99}
        onClick={() => setPage(page + 1)}
      >
        More choices
      </TactileButton>
    </span>
  );
}
