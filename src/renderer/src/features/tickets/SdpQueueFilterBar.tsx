import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import {
  filterValues,
  SdpQueueFiltersSchema,
  type SdpQueueChoiceFilter,
  type SdpQueueFilters,
} from '@shared/sdpQueueFilters';
import { TactileButton } from '../../components/TactileButton';
import { useSdpChoiceList } from './SdpChoicePicker';
import { standardChoiceLoader } from './SdpStandardSelect';

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

function choiceSummary(selected: readonly string[]): string {
  if (!selected.length) return 'All';
  return selected.length === 1 ? selected[0]! : `${selected.length} selected`;
}

const SEARCH_DELAY_MS = 250;
// Within this distance of the menu's end, the next page of SDP's choices starts loading.
const LOAD_AHEAD_PX = 48;

/**
 * A checkbox list behind a select-styled trigger: any number of values can be shown, so the
 * team can keep every status except Closed. The search field at the top of the list searches
 * SDP's own choices, so filters are not limited to the values on the loaded page, and scrolling
 * loads more; page values remain the fallback when SDP cannot list choices. The list closes on
 * Escape or an outside press.
 */
function FilterChoices({
  field,
  label,
  pageNames,
  selected,
  enabled,
  onChange,
}: Readonly<{
  field: SdpQueueChoiceFilter;
  label: string;
  /** Values on the loaded queue page. */
  pageNames: readonly string[];
  selected: readonly string[];
  /** SDP's own choices can be read. */
  enabled: boolean;
  onChange: (selected: string[]) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLFieldSetElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const source = useSdpChoiceList(standardChoiceLoader(field), field);
  const query = text.trim().toLowerCase();
  const local = [...pageNames, ...selected].filter(
    (name) => !query || name.toLowerCase().includes(query),
  );
  // SDP matched the search itself, so its names stay even when the match is not in the name.
  const sdp = enabled ? source.choices.map((choice) => choice.key) : [];
  const names = [...new Set([...sdp, ...local])].filter(Boolean).sort(byName);
  const searchSdp = useEffectEvent((typed: string) => {
    if (enabled) source.search(typed);
  });
  const more = useEffectEvent(() => {
    if (enabled) source.more();
  });
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchSdp(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, text]);
  // A first page too short to scroll still offers the rest.
  useEffect(() => {
    const box = list.current;
    if (box && source.hasMore && !source.loading && box.scrollHeight <= box.clientHeight) more();
  });
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
          if (!open) {
            setText('');
            if (enabled) source.open();
          }
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>{choiceSummary(selected)}</span>
      </button>
      {open && (
        <fieldset
          ref={menu}
          id={`${id}-list`}
          className="sdp-filter-choices__menu"
          aria-busy={source.loading || undefined}
        >
          <legend className="sr-only">Show {label.toLowerCase()}</legend>
          <input
            type="search"
            className="choice-list-search"
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Type to search…"
            value={text}
            maxLength={200}
            // The list opens at its search, as SDP's own filters do.
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter searches as typing does; it never applies the filters from inside the list.
              if (event.key === 'Enter') event.preventDefault();
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              menu.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
            }}
          />
          {/* The choices scroll in their own box: Chromium returns a scrolled fieldset to the top
              whenever its content changes, which made each loaded page jump the list. */}
          <div
            ref={list}
            className="sdp-filter-choices__list"
            onScroll={(event) => {
              const box = event.currentTarget;
              if (box.scrollTop + box.clientHeight >= box.scrollHeight - LOAD_AHEAD_PX && enabled)
                source.more();
            }}
          >
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
            <FilterStatus
              loading={enabled && source.loading}
              failed={enabled && !!source.error}
              empty={!names.length}
              searching={!!query}
            />
          </div>
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

function FilterStatus({
  loading,
  failed,
  empty,
  searching,
}: Readonly<{ loading: boolean; failed: boolean; empty: boolean; searching: boolean }>) {
  let text = '';
  if (loading) text = empty ? 'Loading choices…' : 'Loading more…';
  else if (failed) text = 'SDP choices unavailable. Showing values from this page.';
  else if (empty) text = searching ? 'No matches.' : 'No choices loaded.';
  return text ? <p className="sdp-filter-choices__status">{text}</p> : null;
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
      {choiceFields.map(([key, label]) => (
        <FilterChoices
          key={key}
          field={key}
          label={label}
          pageNames={tickets.map((ticket) => ticket[key])}
          selected={draft[key]}
          enabled={connected && !disabled}
          onChange={(selected) => setDraft({ ...draft, [key]: selected.slice(0, 50) })}
        />
      ))}
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
