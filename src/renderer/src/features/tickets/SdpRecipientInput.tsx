import { useEffect, useId, useRef, useState } from 'react';
import { SDP_SERVER_UPDATE_MESSAGE } from '@shared/sdpAccount';

type Person = { name: string; email: string };
const SEARCH_DELAY_MS = 250;
const SHOWN = 8;
/** Set once a server answers that it predates recipient search; only the ticket's people show. */
let searchUnsupported = false;

const separator = /[,;]/;
/** The address being typed: the text after the last separator. */
function currentToken(value: string): string {
  const parts = value.split(separator);
  return (parts.at(-1) ?? '').trim();
}
function entered(value: string): Set<string> {
  return new Set(
    value
      .split(separator)
      .slice(0, -1)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}
const matches = (person: Person, token: string) =>
  person.email.toLowerCase().includes(token) || person.name.toLowerCase().includes(token);

/**
 * An address field that suggests people as the address is typed: the ticket's own requester and
 * CC first, then people SDP finds for this ticket. A suggestion replaces the typed text; the
 * field stays plain text, so any address can still be typed or pasted.
 */
export function SdpRecipientInput({
  ticketId,
  label,
  value,
  known,
  maxLength,
  onChange,
}: Readonly<{
  ticketId: string;
  label: string;
  value: string;
  /** Addresses the ticket already involves. */
  known: readonly string[];
  maxLength: number;
  onChange: (value: string) => void;
}>) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<{ search: string; people: Person[] }>();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const token = currentToken(value).toLowerCase();
  useEffect(() => {
    if (!focused || token.length < 2 || searchUnsupported) return;
    let current = true;
    const timer = setTimeout(() => {
      void globalThis.api!.sdpAccount!({ action: 'searchRecipients', id: ticketId, search: token })
        .then((reply) => {
          if (!reply.success) {
            if (reply.error === SDP_SERVER_UPDATE_MESSAGE) searchUnsupported = true;
            return;
          }
          const recipients = reply.data?.recipients;
          if (current && recipients) setFound(recipients);
        })
        .catch(() => undefined);
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [focused, token, ticketId]);
  const used = entered(value);
  const people: Person[] = [];
  const add = (person: Person) => {
    const key = person.email.toLowerCase();
    if (
      !used.has(key) &&
      !people.some((p) => p.email.toLowerCase() === key) &&
      matches(person, token)
    )
      people.push(person);
  };
  for (const email of known) add({ name: '', email });
  // Results for an earlier search still narrow as the person keeps typing.
  if (found && token.includes(found.search.toLowerCase()))
    for (const person of found.people) add(person);
  const shown = token ? people.slice(0, SHOWN) : [];
  const open = focused && !dismissed && shown.length > 0;
  const activeIndex = Math.min(index, shown.length - 1);
  function choose(person: Person) {
    const parts = value.split(separator);
    parts[parts.length - 1] = ` ${person.email}`;
    onChange(`${parts.join(',').replace(/^ /, '')}, `);
    setIndex(0);
    input.current?.focus();
  }
  return (
    <label className="ticket-form-wide sdp-recipient-field">
      {label}
      <input
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setIndex(0);
          setDismissed(false);
        }}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setIndex((activeIndex + step + shown.length) % shown.length);
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            const person = shown[activeIndex];
            if (person) choose(person);
          } else if (event.key === 'Escape') {
            // Closes the suggestions before the draft or the ticket can answer Escape.
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            setDismissed(true);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="sdp-recipient-list"
        >
          {shown.map((person, i) => (
            <li
              key={person.email}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'active' : undefined}
              // Choosing keeps focus in the field, so the list is not closed by its blur first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(person);
              }}
            >
              {person.name && person.name !== person.email && <span>{person.name}</span>}
              <span className="sdp-recipient-email">{person.email}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
