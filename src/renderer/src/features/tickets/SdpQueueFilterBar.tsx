import { useEffect, useId, useRef, useState } from 'react';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import type { SdpStandardOptionsCommand } from '@shared/sdpForm';
import {
  filterValues,
  SdpQueueFiltersSchema,
  type SdpQueueChoiceFilter,
  type SdpQueueFilters,
} from '@shared/sdpQueueFilters';
import { TactileButton } from '../../components/TactileButton';

const choiceFields = [
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['technician', 'Technician'],
] as const;
type Draft = Record<SdpQueueChoiceFilter, string[]> & { search: string; due: string };
const byName = (a: string, b: string) => a.localeCompare(b);
const toDraft = (filters?: SdpQueueFilters): Draft => ({
  search: filters?.search ?? '',
  status: filterValues(filters?.status).sort(byName),
  priority: filterValues(filters?.priority).sort(byName),
  technician: filterValues(filters?.technician).sort(byName),
  due: filters?.due ?? '',
});

/** Draft to wire filters: one selection stays a string so older Relay servers accept it. */
function toFilters(draft: Draft): SdpQueueFilters | undefined {
  const search = draft.search.trim();
  const parsed = SdpQueueFiltersSchema.safeParse({
    ...(search ? { search } : {}),
    ...Object.fromEntries(
      choiceFields
        .map(([key]) => [key, [...draft[key]].sort(byName)] as const)
        .filter(([, values]) => values.length)
        .map(([key, values]) => [key, values.length === 1 ? values[0] : values]),
    ),
    ...(draft.due ? { due: draft.due } : {}),
  });
  return parsed.success && Object.keys(parsed.data).length ? parsed.data : undefined;
}

/** Order-insensitive identity, so an echoed or restored filter compares equal to the original. */
export function queueFiltersKey(filters?: SdpQueueFilters): string {
  return JSON.stringify(toFilters(toDraft(filters)) ?? null);
}

/**
 * Lazily loads SDP's own choice list for a filter, so filters are not limited to the values that
 * happen to appear on the loaded page. Page values remain the fallback when SDP cannot list choices.
 */
function useFilterChoices(enabled: boolean) {
  const [choices, setChoices] = useState<Partial<Record<SdpQueueChoiceFilter, string[]>>>({});
  const requested = useRef(new Set<SdpQueueChoiceFilter>());
  function load(field: SdpQueueChoiceFilter) {
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

function choiceSummary(selected: readonly string[]): string {
  if (!selected.length) return 'All';
  return selected.length === 1 ? selected[0]! : `${selected.length} selected`;
}

/**
 * A checkbox list behind a select-styled trigger: any number of values can be shown, so the
 * team can keep every status except Closed. The list closes on Escape or an outside press.
 */
function FilterChoices({
  label,
  names,
  selected,
  onOpen,
  onChange,
}: Readonly<{
  label: string;
  names: readonly string[];
  selected: readonly string[];
  onOpen: () => void;
  onChange: (selected: string[]) => void;
}>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.current?.contains(event.target as Node)) return;
      // Escape closes this list only; the ticket shortcuts skip a handled key.
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      className="sdp-filter-choices"
      ref={root}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className="sdp-filter-choices__trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>{choiceSummary(selected)}</span>
      </button>
      {open && (
        <fieldset id={`${id}-list`} className="sdp-filter-choices__menu">
          <legend className="sr-only">Show {label.toLowerCase()}</legend>
          {names.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, name]
                      : selected.filter((value) => value !== name),
                  )
                }
              />
              <span>{name}</span>
            </label>
          ))}
          {!names.length && <p>No choices loaded.</p>}
          {selected.length > 0 && (
            <TactileButton size="sm" variant="ghost" onClick={() => onChange([])}>
              Show All
            </TactileButton>
          )}
        </fieldset>
      )}
    </div>
  );
}

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
  const pendingChanges = queueFiltersKey(toFilters(draft)) !== queueFiltersKey(applied);
  return (
    <form
      className="sdp-queue-filters"
      aria-label="Queue filters"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && connected) onApply(toFilters(draft));
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
        const names = new Set([
          ...(choices[key] ?? []),
          ...tickets.map((ticket) => ticket[key]),
          ...draft[key],
        ]);
        names.delete('');
        return (
          <FilterChoices
            key={key}
            label={label}
            names={[...names].sort(byName)}
            selected={draft[key]}
            onOpen={() => load(key)}
            onChange={(selected) => setDraft({ ...draft, [key]: selected.slice(0, 50) })}
          />
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
          setDraft(toDraft());
          onApply(undefined);
        }}
      >
        Clear Filters
      </TactileButton>
      {pendingChanges && <output className="sdp-filter-pending">Not applied</output>}
    </form>
  );
}
