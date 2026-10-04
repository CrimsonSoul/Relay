import React, { useCallback, useRef } from 'react';
import { List } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { VirtualRow } from './VirtualRow';
import { VirtualRowData } from './types';
import { getSearchShortcutLabel } from '../../components/command-palette/searchShortcut';
import { EmptyState } from '../../components/EmptyState';
import { PeopleIcon } from '../../components/sidebar/SidebarIcons';
import { TactileButton } from '../../components/TactileButton';
import { useOptionalSearchContext } from '../../contexts/SearchContext';
import type { OnCallBridgeCandidate } from '../../utils/onCallRoles';

type CompositionListProps = {
  log: { email: string; source: string }[];
  itemData: VirtualRowData;
  onScroll: (scrollOffset: number) => void;
  /** Whether any saved groups exist; changes where the empty state points first. */
  hasGroups?: boolean;
  /** On-call people with a directory email who are not yet recipients, offered as one-click adds. */
  onCallSuggestions?: readonly OnCallBridgeCandidate[];
  onAddSuggestion?: (email: string) => void;
  onAddAllSuggestions?: () => void;
  /** Teams with nobody on call, so a bridge never silently misses them. */
  vacantOnCallTeams?: readonly string[];
  /** Opens On-Call, where a vacant team gets its coverage assigned. */
  onAssignOnCall?: () => void;
};

type OnCallNowProps = Readonly<{
  isStrip: boolean;
  suggestions: readonly OnCallBridgeCandidate[];
  onAddSuggestion?: (email: string) => void;
  onAddAllSuggestions?: () => void;
  vacantTeams: readonly string[];
  onAssignOnCall?: () => void;
}>;

/**
 * "On call now": uncovered teams first (they are the gap a bridge would otherwise hide), then the
 * on-call people still missing from the bridge. A full grid in the empty state, a single scrolling
 * row above a non-empty recipient list.
 */
function OnCallNow({
  isStrip,
  suggestions,
  onAddSuggestion,
  onAddAllSuggestions,
  vacantTeams,
  onAssignOnCall,
}: OnCallNowProps) {
  const showSuggestions = suggestions.length > 0 && !!onAddSuggestion;
  if (!showSuggestions && vacantTeams.length === 0) return null;
  return (
    <section
      className={`composition-list-suggestions${isStrip ? ' composition-list-suggestions--strip' : ''}`}
      aria-labelledby="composition-list-suggestions-title"
    >
      <div className="composition-list-suggestions-header">
        <h3 id="composition-list-suggestions-title">On call now</h3>
        {showSuggestions && onAddAllSuggestions && suggestions.length > 1 && (
          <TactileButton size="sm" onClick={onAddAllSuggestions}>
            Add All On Call ({suggestions.length})
          </TactileButton>
        )}
      </div>
      {vacantTeams.length > 0 && (
        <ul className="composition-list-vacancies" aria-label="Teams with no coverage">
          {vacantTeams.map((team) => (
            <li key={team} className="composition-list-vacancy">
              <span className="composition-list-vacancy-text">
                <span className="composition-list-vacancy-team">{team}</span>
                {' — '}
                <span className="composition-list-vacancy-status">No coverage</span>
              </span>
              {onAssignOnCall && (
                <TactileButton
                  size="sm"
                  variant="secondary"
                  className="composition-list-vacancy-assign"
                  aria-label={`Assign On-Call for ${team}`}
                  onClick={onAssignOnCall}
                  icon={
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  }
                >
                  Assign On-Call
                </TactileButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {showSuggestions && (
        <ul>
          {suggestions.map((suggestion) => (
            <li key={suggestion.email}>
              <button
                type="button"
                className="composition-list-suggestion"
                aria-label={`Add ${suggestion.name}, ${suggestion.role}, ${suggestion.team}`}
                onClick={() => onAddSuggestion?.(suggestion.email)}
              >
                <span className="composition-list-suggestion-plus" aria-hidden="true">
                  +
                </span>
                <span className="composition-list-suggestion-name">{suggestion.name}</span>
                <span className="composition-list-suggestion-meta">
                  <span className="composition-list-suggestion-detail">
                    {suggestion.role} · {suggestion.team}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Empty-state sentence. The header search field and the Search Relay CTA already name search, and
 * History sits in the command bar, so beside the CTA the sentence adds only what is new. Without
 * the CTA (no search context) the sentence is the only route, so it names Search Relay and its
 * shortcut.
 */
function emptyDescription(
  hasGroups: boolean,
  shortcut: string,
  hasSearchCta: boolean,
): React.ReactElement {
  if (hasSearchCta) {
    return (
      <>
        {hasGroups
          ? 'Select a group on the left, or search for contacts and groups.'
          : 'You can also type or paste email addresses into search.'}
      </>
    );
  }
  if (hasGroups) {
    return (
      <>
        Select a group on the left, or use Search Relay (<kbd className="kbd-key">{shortcut}</kbd>)
        to find contacts and groups.
      </>
    );
  }
  return (
    <>
      Use Search Relay (<kbd className="kbd-key">{shortcut}</kbd>) to find contacts, or type or
      paste email addresses there to add them.
    </>
  );
}

export const CompositionList: React.FC<CompositionListProps> = ({
  log,
  itemData,
  onScroll,
  hasGroups = false,
  onCallSuggestions = [],
  onAddSuggestion,
  onAddAllSuggestions,
  vacantOnCallTeams = [],
  onAssignOnCall,
}) => {
  const searchContext = useOptionalSearchContext();
  const containerRef = useRef<HTMLDivElement>(null);

  // Delete/Backspace on a focused recipient row removes it, then keeps focus in the list.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!(event.target instanceof HTMLElement)) return;
      const row = event.target.closest<HTMLElement>('[data-record-key]');
      const email = row?.dataset.recordKey;
      if (!email) return;
      event.preventDefault();
      const index = log.findIndex((entry) => entry.email === email);
      const nextEmail = log[index + 1]?.email ?? log[index - 1]?.email;
      itemData.onRemoveManual(email);
      if (!nextEmail) return;
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-record-key="${CSS.escape(nextEmail)}"]`)
          ?.focus();
      });
    },
    [itemData, log],
  );

  const suggestions = (
    <OnCallNow
      isStrip={log.length > 0}
      suggestions={onCallSuggestions}
      onAddSuggestion={onAddSuggestion}
      onAddAllSuggestions={onAddAllSuggestions}
      vacantTeams={vacantOnCallTeams}
      onAssignOnCall={onAssignOnCall}
    />
  );

  if (log.length === 0) {
    const shortcut = getSearchShortcutLabel();
    return (
      <EmptyState
        className="composition-list-scroll"
        title="No recipients selected"
        glyph={<PeopleIcon />}
        description={emptyDescription(hasGroups, shortcut, Boolean(searchContext))}
        actions={
          // Adding recipients is the one next step; History stays in the command bar above
          // rather than repeating here (DESIGN.md "Empty states").
          searchContext && (
            <TactileButton variant="primary" onClick={searchContext.focusSearch}>
              Search Relay <kbd className="empty-state__kbd">{shortcut}</kbd>
            </TactileButton>
          )
        }
      >
        {suggestions}
      </EmptyState>
    );
  }

  return (
    <div className="composition-list-stack">
      {suggestions}
      {/* Keyboard handling for focused row buttons bubbles here; the wrapper itself is not a control. */}
      <div
        ref={containerRef}
        className="composition-list-container"
        role="presentation"
        onKeyDown={handleKeyDown}
      >
        <p className="sr-only">Press Delete on a focused recipient to remove it.</p>
        <AutoSizer
          renderProp={({ height, width }) => (
            <List
              style={{ height: height ?? 0, width: width ?? 0 }}
              rowCount={log.length}
              rowHeight={72}
              rowComponent={VirtualRow}
              rowProps={itemData}
              onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
            />
          )}
        />
      </div>
    </div>
  );
};
