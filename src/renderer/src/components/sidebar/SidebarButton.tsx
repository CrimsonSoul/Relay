import React from 'react';
import { Tooltip } from '../Tooltip';
import { getGlobalShortcut } from '../command-palette/searchShortcut';

/**
 * An at-a-glance signal rendered on the button itself, so a destination can
 * report its state without the user opening it.
 *
 * `announcement` is not optional decoration: `aria-label` replaces a button's
 * inner text for assistive tech, so the announcement carries the full state
 * description and ensures the signal never depends on distinguishing tint
 * colours.
 */
export type SidebarButtonStatus = {
  tone: string;
  announcement: string;
  /**
   * The state may be out of date (its feed is off or failing): a slashed-ring mark, the failing
   * feed's shape, follows the pip on the label line, and the accessible name and tooltip say "not
   * syncing" in words. The word itself stays undecorated, because dashed means unavailable in
   * Relay's grammar and a stale count is still the last known count.
   */
  stale?: boolean;
  /**
   * One short visible word for an alarm, failing or warning state ("Unavailable", "Outage", "No
   * coverage", "2"). It takes the one state line under the label, across the full content width,
   * in the tone's ink, so the state never depends on recognising the pip's shape.
   */
  word?: string;
  /**
   * A noun that completes a count word ("unaddressed" after "2"). It follows the word on the one
   * state line.
   */
  noun?: string;
};

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  status?: SidebarButtonStatus | null;
  /** Key of the app-wide shortcut that opens this destination (`1`–`8`, `,` for Settings). */
  shortcutKey?: string;
  /** Reordering keys and the destination's context menu (Sidebar). */
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
}

/** The state the rail shows, in reading order: word, noun, then "not syncing" for the stale mark. */
function visibleStateFor(status: SidebarButtonStatus): string {
  const parts = [status.word, status.noun].filter(Boolean).join(' ');
  return status.stale ? `${parts} · not syncing` : parts;
}

/** Label first, then any visible state text, then the full state (label-in-name, WCAG 2.5.3). */
function accessibleNameFor(label: string, status: SidebarButtonStatus | null): string {
  if (!status) return label;
  const visible = status.word ? `${label} · ${visibleStateFor(status)}` : label;
  return `${visible} — ${status.announcement}`;
}

export const SidebarButton: React.FC<SidebarButtonProps> = React.memo(
  ({ icon, label, isActive, onClick, status = null, shortcutKey, onKeyDown, onContextMenu }) => {
    const accessibleName = accessibleNameFor(label, status);
    const shortcut = shortcutKey ? getGlobalShortcut(shortcutKey) : null;
    // The tooltip teaches the shortcut (recognition over recall) and, for status destinations,
    // repeats the pip beside its meaning so the shape doubles as its own legend.
    const tooltip = (
      <span className="sidebar-tooltip">
        <span className="sidebar-tooltip-heading">
          <span>{label}</span>
          {shortcut && <kbd className="sidebar-tooltip-key">{shortcut.label}</kbd>}
        </span>
        {status && (
          <span className="sidebar-tooltip-status">
            <span
              className="sidebar-button-status-dot sidebar-tooltip-pip"
              data-status-tone={status.tone}
              aria-hidden="true"
            />
            <span>{status.announcement}</span>
          </span>
        )}
        {status?.stale && (
          <span className="sidebar-tooltip-status">
            <span className="sidebar-button-stale-mark sidebar-tooltip-pip" aria-hidden="true" />
            <span>Not syncing</span>
          </span>
        )}
      </span>
    );
    // The rail pip sits on the label line, right after the label, so the state line below it gets
    // the full content width.
    const pip = status ? (
      <span
        className="sidebar-button-status-dot"
        data-status-tone={status.tone}
        aria-hidden="true"
      />
    ) : null;

    // The accessible name already carries the label and full state, and aria-keyshortcuts the
    // shortcut, so the tooltip is visual only and is not linked as a description.
    return (
      <Tooltip content={tooltip} position="right" describesTrigger={false}>
        <button
          type="button"
          aria-label={accessibleName}
          aria-keyshortcuts={shortcut?.aria}
          aria-current={isActive ? 'page' : undefined}
          data-testid={`sidebar-${label.toLowerCase().replaceAll(/\s+/g, '-')}`}
          data-active={isActive}
          data-status-tone={status?.tone}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onContextMenu={onContextMenu}
          className={`sidebar-button${isActive ? ' sidebar-button--active' : ''}${
            status ? ' sidebar-button--status' : ''
          }${status?.word ? ' sidebar-button--has-word' : ''}`}
        >
          <span className="sidebar-button-icon">{icon}</span>
          <span className="sidebar-button-heading">
            <span className="sidebar-button-label">{label}</span>
            {pip}
            {status?.stale && <span className="sidebar-button-stale-mark" aria-hidden="true" />}
          </span>
          {status?.word && (
            <span className="sidebar-button-state" aria-hidden="true">
              <span className="sidebar-button-status-word">{status.word}</span>
              {status.noun && <span className="sidebar-button-status-noun">{status.noun}</span>}
            </span>
          )}
          {isActive && <span className="sidebar-button-indicator" />}
        </button>
      </Tooltip>
    );
  },
);
