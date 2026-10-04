import { useRef, useState } from 'react';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import type { SdpStandardOptionsCommand } from '@shared/sdpForm';
import { SdpQueueFiltersSchema, type SdpQueueFilters } from '@shared/sdpQueueFilters';
import { TactileButton } from '../../components/TactileButton';

type ChoiceField = 'status' | 'priority' | 'technician';
const choiceFields = [
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['technician', 'Technician'],
] as const;
type Draft = Record<ChoiceField | 'search', string> & { due: string };
const toDraft = (filters?: SdpQueueFilters): Draft => ({
  search: filters?.search ?? '',
  status: filters?.status ?? '',
  priority: filters?.priority ?? '',
  technician: filters?.technician ?? '',
  due: filters?.due ?? '',
});

/**
 * Lazily loads SDP's own choice list for a filter, so filters are not limited to the values that
 * happen to appear on the loaded page. Page values remain the fallback when SDP cannot list choices.
 */
function useFilterChoices(enabled: boolean) {
  const [choices, setChoices] = useState<Partial<Record<ChoiceField, string[]>>>({});
  const requested = useRef(new Set<ChoiceField>());
  function load(field: ChoiceField) {
    const invoke = globalThis.api?.sdpAccount;
    if (!enabled || !invoke || requested.current.has(field)) return;
    requested.current.add(field);
    const command: SdpStandardOptionsCommand = {
      action: 'readStandardOptions',
      field,
      search: '',
      page: 0,
    };
    void invoke(command)
      .then((result) => {
        const options = result.success ? result.data?.options : undefined;
        if (options?.field !== field) throw new Error('Choices unavailable.');
        const names = options.choices.map(choiceName);
        setChoices((old) => ({ ...old, [field]: names }));
      })
      .catch(() => requested.current.delete(field));
  }
  return { choices, load };
}

const choiceName = (choice: Readonly<{ label: string; value: unknown }>): string => {
  if (typeof choice.value === 'object' && choice.value !== null && 'name' in choice.value)
    return typeof choice.value.name === 'string' ? choice.value.name : choice.label;
  return typeof choice.value === 'string' ? choice.value : choice.label;
};

export function SdpQueueFilterBar({
  applied,
  tickets,
  disabled,
  connected,
  onApply,
}: Readonly<{
  applied?: SdpQueueFilters;
  tickets: readonly SdpQueueTicket[];
  disabled: boolean;
  connected: boolean;
  onApply: (filters?: SdpQueueFilters) => void;
}>) {
  const [draft, setDraft] = useState(() => toDraft(applied));
  const { choices, load } = useFilterChoices(connected && !disabled);
  const pendingChanges = JSON.stringify(draft) !== JSON.stringify(toDraft(applied));
  function apply(next: Draft) {
    const parsed = SdpQueueFiltersSchema.safeParse(
      Object.fromEntries(
        Object.entries({ ...next, search: next.search.trim() }).filter(([, value]) => value),
      ),
    );
    const filters = parsed.success ? parsed.data : {};
    onApply(Object.keys(filters).length ? filters : undefined);
  }
  return (
    <form
      className="sdp-queue-filters"
      aria-label="Queue filters"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && connected) apply(draft);
      }}
    >
      <label className="ticket-search">
        <span>Search queue</span>
        <input
          value={draft.search}
          maxLength={200}
          onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          placeholder="Subject, ticket number or technician…"
        />
      </label>
      {choiceFields.map(([key, label]) => {
        const names = new Set([...(choices[key] ?? []), ...tickets.map((ticket) => ticket[key])]);
        if (draft[key]) names.add(draft[key]);
        names.delete('');
        return (
          <label key={key}>
            {label}
            <select
              aria-label={label}
              value={draft[key]}
              onFocus={() => load(key)}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            >
              <option value="">All</option>
              {[...names]
                .sort((a, b) => a.localeCompare(b))
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
          </label>
        );
      })}
      <label>
        <span>Due</span>
        <select
          aria-label="Due"
          value={draft.due}
          onChange={(event) => setDraft({ ...draft, due: event.target.value })}
        >
          <option value="">Any time</option>
          <option value="overdue">Overdue</option>
          <option value="today">Next 24 hours</option>
        </select>
      </label>
      <TactileButton size="sm" type="submit" disabled={disabled || !connected}>
        Apply Filters
      </TactileButton>
      <TactileButton
        size="sm"
        variant="ghost"
        disabled={disabled || !connected}
        onClick={() => {
          const empty = toDraft();
          setDraft(empty);
          apply(empty);
        }}
      >
        Clear Filters
      </TactileButton>
      {pendingChanges && <output className="sdp-filter-pending">Not applied</output>}
    </form>
  );
}
