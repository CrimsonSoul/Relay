import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { SdpIcon } from './SdpIcon';

export type SdpPickerChoice<T> = Readonly<{ key: string; label: string; value: T }>;
export type SdpChoicePage<T> = Readonly<{ choices: SdpPickerChoice<T>[]; hasMore: boolean }>;
export type SdpChoiceLoader<T> = (search: string, page: number) => Promise<SdpChoicePage<T>>;

const SEARCH_DELAY_MS = 250;
const VIEWPORT_MARGIN = 8;
// Within this distance of the list's end, the next page starts loading.
const LOAD_AHEAD_PX = 48;
const CHOICES_UNAVAILABLE = 'Choices unavailable. Type to search again.';

/**
 * One SDP choice list: the first page loads when the list is shown, typed text searches SDP, and
 * the next page loads as the list nears its end. A new reset key (such as a changed parent field)
 * or a newer search drops older replies.
 */
export function useSdpChoiceList<T>(load: SdpChoiceLoader<T>, resetKey: string) {
  const [choices, setChoices] = useState<SdpPickerChoice<T>[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const epoch = useRef(0);
  const state = useRef({ search: '', page: 0, loaded: false, busy: false });
  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    epoch.current++;
    state.current = { search: '', page: 0, loaded: false, busy: false };
    setChoices([]);
    setHasMore(false);
    setLoading(false);
    setError('');
    setGeneration((value) => value + 1);
  }, [resetKey]);
  async function request(search: string, page: number) {
    const current = ++epoch.current;
    state.current = page
      ? { ...state.current, busy: true }
      : { search, page: 0, loaded: false, busy: true };
    setLoading(true);
    setError('');
    try {
      const result = await loader.current(search, page);
      if (current !== epoch.current) return;
      setChoices((old) => {
        const kept = page ? old : [];
        const known = new Set(kept.map((choice) => choice.key));
        const added = result.choices.filter((choice) => {
          if (known.has(choice.key)) return false;
          known.add(choice.key);
          return true;
        });
        return [...kept, ...added];
      });
      setHasMore(result.hasMore);
      state.current = { search, page, loaded: true, busy: false };
    } catch {
      if (current === epoch.current) setError(CHOICES_UNAVAILABLE);
    } finally {
      if (current === epoch.current) {
        state.current = { ...state.current, busy: false };
        setLoading(false);
      }
    }
  }
  return {
    choices,
    hasMore,
    loading,
    error,
    generation,
    /** Shows the unsearched first page, loading it unless it is already there. */
    open() {
      const { search, loaded, busy } = state.current;
      if (search || (!loaded && !busy)) void request('', 0);
    },
    search(text: string) {
      const { search, loaded, busy } = state.current;
      if (text !== search || (!loaded && !busy)) void request(text, 0);
    },
    more() {
      if (hasMore && !state.current.busy)
        void request(state.current.search, state.current.page + 1);
    },
  };
}
export type SdpChoiceSource<T> = ReturnType<typeof useSdpChoiceList<T>>;

type ListProps<T> = Readonly<{
  label: string;
  /** Keys of the current selection. */
  selected: readonly string[];
  /** Fixed choices, filtered by the typed text. Without them, `source` reads SDP. */
  choices?: readonly SdpPickerChoice<T>[];
  source?: SdpChoiceSource<T>;
  /** Choices before the results (Not set, Unassigned) while nothing is typed. */
  leading?: readonly SdpPickerChoice<T>[];
  multiple?: boolean;
  disabled?: boolean;
  onSelect: (choice: SdpPickerChoice<T>) => void;
}>;

/**
 * The search field and the list it filters. The field keeps focus: Arrow keys move through the
 * list, Enter chooses, and typing searches SDP. Scrolling near the end loads the next page.
 */
export function SdpChoiceList<T>({
  label,
  selected,
  choices: fixed,
  source,
  leading = [],
  multiple = false,
  disabled = false,
  onSelect,
}: ListProps<T>) {
  const [text, setText] = useState('');
  const query = text.trim().toLowerCase();
  const results = fixed
    ? fixed.filter((choice) => !query || choice.label.toLowerCase().includes(query))
    : (source?.choices ?? []);
  const lead = query ? [] : leading;
  const leadKeys = new Set(lead.map((choice) => choice.key));
  const visible = [...lead, ...results.filter((choice) => !leadKeys.has(choice.key))];
  const chosen = new Set(selected);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      visible.findIndex((choice) => chosen.has(choice.key)),
    ),
  );
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;
  const show = useEffectEvent(() => source?.open());
  const search = useEffectEvent((typed: string) => source?.search(typed));
  const more = useEffectEvent(() => source?.more());
  useEffect(() => {
    input.current?.focus();
    show();
  }, []);
  const generation = source?.generation;
  useEffect(() => {
    // A reset (a new generation) searches again for the text already typed.
    const timer = setTimeout(() => search(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, generation]);
  // A first page too short to scroll still offers the rest.
  useEffect(() => {
    const box = list.current;
    if (box && source?.hasMore && !source.loading && box.scrollHeight <= box.clientHeight) more();
  });
  const activeId = optionId(active);
  useEffect(() => {
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  function move(step: number) {
    if (!visible.length) return;
    const next = Math.min(Math.max(active + step, 0), visible.length - 1);
    setActive(next);
    if (next >= visible.length - 3) source?.more();
  }
  function keyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      PageDown: () => move(8),
      PageUp: () => move(-8),
      Enter: () => {
        const choice = visible[active];
        if (choice && !disabled) onSelect(choice);
      },
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }
  const status = listStatus(source, visible.length, !!query);
  return (
    <>
      <input
        ref={input}
        role="combobox"
        className="choice-list-search"
        aria-label={`Search ${label} choices`}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={visible[active] ? activeId : undefined}
        placeholder="Type to search…"
        value={text}
        maxLength={200}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
        }}
        onKeyDown={keyDown}
      />
      {/* The status scrolls after the options, so a loading page never resizes the list. */}
      <div
        ref={list}
        className="sdp-picker__list"
        onScroll={(event) => {
          const box = event.currentTarget;
          if (box.scrollTop + box.clientHeight >= box.scrollHeight - LOAD_AHEAD_PX) source?.more();
        }}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          aria-busy={source?.loading || undefined}
        >
          {visible.map((choice, index) => (
            // The search field keeps focus and answers the keyboard (aria-activedescendant).
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={`${index < lead.length ? 'lead' : 'choice'}:${choice.key}`}
              id={optionId(index)}
              role="option"
              aria-selected={chosen.has(choice.key)}
              aria-disabled={disabled || undefined}
              className={index === active ? 'is-active' : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => {
                if (disabled) return;
                setActive(index);
                onSelect(choice);
              }}
            >
              <span>{choice.label}</span>
              {chosen.has(choice.key) && <SdpIcon name="check" />}
            </li>
          ))}
        </ul>
        {status && (
          <p className="sdp-picker__status" role={source?.error ? 'alert' : 'status'}>
            {status}
          </p>
        )}
      </div>
    </>
  );
}

function listStatus<T>(
  source: SdpChoiceSource<T> | undefined,
  count: number,
  searching: boolean,
): string {
  if (source?.error) return source.error;
  if (source?.loading) return count ? 'Loading more…' : 'Loading choices…';
  if (!count) return searching ? 'No matches.' : 'No choices.';
  return '';
}

type PickerProps<T> = Omit<ListProps<T>, 'source'> &
  Readonly<{
    /** The trigger's id, for a `<label htmlFor>` beside it. */
    id?: string;
    required?: boolean;
    /** The selection as text; empty shows the placeholder. */
    display: string;
    placeholder: string;
    /** Reads SDP when there are no fixed choices. */
    load?: SdpChoiceLoader<T>;
    /** A changed key (a parent field's value) reloads the list. */
    resetKey?: string;
    describedBy?: string;
    /** Opens the list as soon as the picker appears (inline quick edits). */
    autoOpen?: boolean;
  }>;

const noChoices = async () => ({ choices: [], hasMore: false });

/**
 * A select-only combobox for SDP choices, as SDP's own dropdowns work: one press opens the list
 * with its search field focused at the top, typing searches, and scrolling loads more. Escape or
 * Tab closes it and returns to the field. The list is portaled into the enclosing dialog, so the
 * dialog's focus trap and outside presses treat it as part of the dialog.
 */
export function SdpChoicePicker<T>({
  id,
  label,
  required = false,
  selected,
  display,
  placeholder,
  choices,
  load,
  resetKey = '',
  leading,
  multiple = false,
  disabled = false,
  describedBy,
  autoOpen = false,
  onSelect,
}: PickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const source = useSdpChoiceList<T>(load ?? noChoices, resetKey);
  const panelId = useId();

  function show() {
    if (disabled) return;
    setHost(trigger.current?.closest('dialog') ?? document.body);
    setOpen(true);
  }
  function hide(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  const dismiss = useEffectEvent(hide);
  const openOnMount = useEffectEvent(show);
  useEffect(() => {
    if (autoOpen) openOnMount();
  }, [autoOpen]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      dismiss(false);
    };
    // Escape and Tab leave only this list, before a quick edit, dialog, focus trap or ticket
    // shortcut sees them, and focus returns to the field rather than past the portaled list.
    const keys = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;
      if (!panel.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keys, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keys, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => placePanel(trigger.current, panel.current);
    place();
    const reposition = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) place();
    };
    globalThis.addEventListener('resize', place);
    globalThis.addEventListener('scroll', reposition, true);
    return () => {
      globalThis.removeEventListener('resize', place);
      globalThis.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className="sdp-picker"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          show();
        }}
      >
        <span className={display ? undefined : 'sdp-picker__placeholder'}>
          {display || placeholder}
        </span>
        <SdpIcon name="chevron" />
      </button>
      {open &&
        host &&
        createPortal(
          <div ref={panel} id={panelId} className="sdp-picker__panel" data-motion="popover">
            <SdpChoiceList
              label={label}
              selected={selected}
              choices={load ? undefined : choices}
              source={load ? source : undefined}
              leading={leading}
              multiple={multiple}
              onSelect={(choice) => {
                onSelect(choice);
                if (!multiple) hide(true);
              }}
            />
          </div>,
          host,
        )}
    </>
  );
}

/** Below the field, or above it when the space below is short; never wider than the window. */
function placePanel(anchor: HTMLElement | null, box: HTMLElement | null) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect || !box) return;
  const width = Math.min(Math.max(rect.width, 240), globalThis.innerWidth - 2 * VIEWPORT_MARGIN);
  const below = globalThis.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const above = rect.top - VIEWPORT_MARGIN;
  const upward = below < 220 && above > below;
  box.style.width = `${width}px`;
  box.style.maxHeight = `${Math.min(360, upward ? above : below) - 4}px`;
  box.style.left = `${Math.min(Math.max(rect.left, VIEWPORT_MARGIN), globalThis.innerWidth - width - VIEWPORT_MARGIN)}px`;
  box.style.top = upward ? '' : `${rect.bottom + 4}px`;
  box.style.bottom = upward ? `${globalThis.innerHeight - rect.top + 4}px` : '';
}
