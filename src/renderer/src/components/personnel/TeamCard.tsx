import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { OnCallRow, Contact } from '@shared/ipc';
import { getColorForString } from '../../utils/colors';
import { Tooltip } from '../Tooltip';
import { MaintainTeamModal } from '../MaintainTeamModal';
import { ContextMenuItem } from '../ContextMenu';
import { TeamRow } from './TeamRow';
import { isTimeWindowActive } from '../../utils/timeParsing';
import {
  indexContactsByName,
  isStaffedOnCallRow,
  matchDirectoryContact,
} from '../../utils/onCallRoles';
import { useIsTruncated } from '../../hooks/useIsTruncated';

/** Pending "Remove Team" confirmation, carrying how many members go with it. */
export interface TeamRemoveConfirm {
  team: string;
  memberCount: number;
  onConfirm: () => void;
}

interface TeamCardProps {
  team: string;
  index?: number;
  rows: OnCallRow[];
  contacts: Contact[];
  onUpdateRows: (team: string, rows: OnCallRow[], baselineIds: string[]) => void | Promise<void>;
  onRenameTeam: (oldName: string, newName: string) => void;
  onRemoveTeam: (team: string) => void;
  setConfirm: (confirm: TeamRemoveConfirm | null) => void;
  setMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  onCopyTeamInfo?: (team: string, rows: OnCallRow[]) => void;
  isReadOnly?: boolean;
  tick?: number;
  coverage?: React.ReactNode;
  /** dnd-kit bindings: the focusable card itself is the keyboard drag activator. */
  dragAttributes?: Pick<DraggableAttributes, 'aria-roledescription' | 'aria-describedby'>;
  dragListeners?: DraggableSyntheticListeners;
  dragActivatorRef?: (node: HTMLElement | null) => void;
}

const copyIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const isMenuKey = (event: React.KeyboardEvent) =>
  event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

export const TeamCard = React.memo(
  ({
    team,
    index: _index,
    rows,
    contacts,
    onUpdateRows,
    onRenameTeam,
    onRemoveTeam,
    setConfirm,
    setMenu,
    onCopyTeamInfo,
    isReadOnly = false,
    tick,
    coverage,
    dragAttributes,
    dragListeners,
    dragActivatorRef,
  }: TeamCardProps) => {
    // Read each render (not memoised): the accent can change, and identity skips accent-near hues.
    const colorScheme = getColorForString(team);
    const [isEditing, setIsEditing] = useState(false);
    // The team name ellipsizes on its wrapper; measure that box, not the inline name span.
    const [teamNameRef, teamNameTruncated] = useIsTruncated<HTMLDivElement>(team);
    const teamRows = useMemo(() => rows || [], [rows]);
    const hasAnyTimeWindow = useMemo(() => teamRows.some((r) => r.timeWindow?.trim()), [teamRows]);
    const rowGridTemplate = hasAnyTimeWindow ? 'auto 1fr auto 100px' : 'auto 1fr auto';
    const staffedRows = useMemo(() => teamRows.filter(isStaffedOnCallRow), [teamRows]);
    const contactsByName = useMemo(() => indexContactsByName(contacts), [contacts]);
    // Display-only: a named row saved without a number borrows its unique directory match's phone.
    const directoryPhones = useMemo(() => {
      const phones = new Map<string, string>();
      for (const row of teamRows) {
        if (row.contact.trim() || !row.name.trim()) continue;
        const phone = matchDirectoryContact(row.name, contactsByName)?.phone.trim();
        if (phone) phones.set(row.id, phone);
      }
      return phones;
    }, [contactsByName, teamRows]);
    const health = useMemo(() => {
      // A vacant team already says "No coverage" in its body; a second badge would repeat it.
      if (staffedRows.length === 0) return null;

      const activeCount = teamRows.filter((row) =>
        isTimeWindowActive(row.timeWindow || '', new Date(tick ?? Date.now())),
      ).length;
      if (activeCount > 0) {
        return { label: `${activeCount} active`, tone: 'ok' };
      }

      // Only a true gap: no saved number and no unique directory number to fall back on.
      const missingContact = staffedRows.some(
        (row) => !row.contact.trim() && !directoryPhones.has(row.id),
      );

      if (missingContact) {
        return { label: 'Needs contact', tone: 'watch' };
      }

      return null;
    }, [directoryPhones, staffedRows, teamRows, tick]);

    // Same rule as Compose's vacancy rows and the sidebar pip (getVacantOnCallTeams).
    const isEmpty = staffedRows.length === 0;
    const emptyStateContent = (
      <div className="team-card-empty">
        <span className="team-card-empty-label">
          <span className="team-card-empty-status">No coverage</span>
        </span>
        {!isReadOnly && (
          <Tooltip content={`Assign On-Call for ${team}`}>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="team-card-assign-btn"
              aria-label={`Assign On-Call for ${team}`}
            >
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
              Assign On-Call
            </button>
          </Tooltip>
        )}
      </div>
    );

    const menuItems = useMemo<ContextMenuItem[]>(() => {
      const copyItems: ContextMenuItem[] = onCopyTeamInfo
        ? [
            {
              label: 'Copy On-Call Info',
              onClick: () => onCopyTeamInfo(team, teamRows),
              icon: copyIcon,
            },
          ]
        : [];
      if (isReadOnly) return copyItems;
      return [
        ...copyItems,
        { label: 'Edit Team', onClick: () => setIsEditing(true) },
        { label: 'Rename Team', onClick: () => onRenameTeam(team, team) },
        {
          label: 'Remove Team',
          danger: true,
          onClick: () =>
            setConfirm({
              team,
              memberCount: staffedRows.length,
              onConfirm: () => onRemoveTeam(team),
            }),
        },
      ];
    }, [
      isReadOnly,
      onCopyTeamInfo,
      onRemoveTeam,
      onRenameTeam,
      setConfirm,
      staffedRows,
      team,
      teamRows,
    ]);
    // Names the menu's actions so the `···` button is discoverable without opening it.
    const menuActionSummary = menuItems.map((item) => item.label.split(' ')[0]).join(', ');

    const cardRef = useRef<HTMLDivElement | null>(null);
    const setCardRef = useCallback(
      (node: HTMLDivElement | null) => {
        cardRef.current = node;
        dragActivatorRef?.(node);
      },
      [dragActivatorRef],
    );
    const openContextMenu = useCallback(
      (x: number, y: number) => {
        setMenu({ x, y, items: menuItems });
      },
      [menuItems, setMenu],
    );

    /** Keyboard/button menus anchor below the element that requested them. */
    const openMenuAt = useCallback(
      (element: Element) => {
        const rect = element.getBoundingClientRect();
        openContextMenu(rect.left, rect.bottom);
      },
      [openContextMenu],
    );

    useEffect(() => {
      const cardNode = cardRef.current;
      if (!cardNode) return;

      const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(event.clientX, event.clientY);
      };

      cardNode.addEventListener('contextmenu', handleContextMenu);
      return () => cardNode.removeEventListener('contextmenu', handleContextMenu);
    }, [openContextMenu]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      // The Edit Team dialog is portaled out of the card but its key events still bubble here
      // through React; Shift+F10 typed in that dialog must not open this card's menu behind it.
      if (!event.currentTarget.contains(event.target as Node)) return;
      if (isMenuKey(event)) {
        event.preventDefault();
        openMenuAt(event.currentTarget);
        return;
      }
      dragListeners?.onKeyDown?.(event);
    };

    return (
      <>
        {/* The card is the keyboard focus target for drag reorder and Shift+F10;
            it holds its own buttons, so it is a focusable group, not a button. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          {...dragAttributes}
          {...dragListeners}
          ref={setCardRef}
          role="group"
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          aria-label={`${team} team`}
          onKeyDown={handleKeyDown}
          className={`card-surface team-card-body ${isReadOnly ? 'team-card-body--readonly' : 'lift-on-hover'}${isEmpty ? ' team-card-body--vacant' : ''}`}
          style={
            {
              '--team-color': colorScheme.text,
              '--team-color-fill': colorScheme.fill,
            } as React.CSSProperties
          }
        >
          <div className="team-card-header-row">
            <div className="team-card-name" ref={teamNameRef}>
              <Tooltip content={team}>
                {/* The team name ellipsizes; only then is it a focus stop that reveals the full
                    team name (the card group's own name already carries it for screen readers). */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                <span tabIndex={teamNameTruncated ? 0 : undefined}>{team}</span>
              </Tooltip>
            </div>
            <div className="team-card-header-meta">
              {health && (
                <span className={`team-health-badge team-health-badge--${health.tone}`}>
                  {health.label}
                </span>
              )}
              {menuItems.length > 0 && (
                <Tooltip content={`Team Actions: ${menuActionSummary} · Shift+F10`}>
                  <button
                    type="button"
                    className="team-card-menu-btn"
                    aria-label={`${team} Team Actions: ${menuActionSummary}`}
                    aria-haspopup="menu"
                    aria-keyshortcuts="Shift+F10"
                    onClick={(event) => openMenuAt(event.currentTarget)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="5" cy="12" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="19" cy="12" r="2" />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="team-card-rows">
            {isEmpty
              ? emptyStateContent
              : teamRows.map((row) => (
                  <TeamRow
                    key={row.id}
                    row={row}
                    directoryPhone={directoryPhones.get(row.id)}
                    hasAnyTimeWindow={hasAnyTimeWindow}
                    gridTemplate={rowGridTemplate}
                    tick={tick}
                  />
                ))}
          </div>
          {coverage}
        </div>
        <MaintainTeamModal
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          teamName={team}
          initialRows={teamRows}
          contacts={contacts}
          onSave={onUpdateRows}
        />
      </>
    );
  },
  (prev, next) => {
    if (prev.coverage !== next.coverage) return false;
    if (prev.tick !== next.tick) return false;
    if (prev.index !== next.index) return false;
    if (prev.team !== next.team) return false;
    if (prev.isReadOnly !== next.isReadOnly) return false;
    if (prev.contacts !== next.contacts) return false;
    if (
      prev.dragAttributes !== next.dragAttributes ||
      prev.dragListeners !== next.dragListeners ||
      prev.dragActivatorRef !== next.dragActivatorRef
    ) {
      return false;
    }
    // The callbacks close over board state — onRemoveTeam captures the current
    // teamOrder. A card that skipped a re-render (its index was untouched by a
    // drag reorder) would keep the pre-drag closure and write that stale order
    // back to the server, silently reverting a reorder the user just saw.
    if (
      prev.onUpdateRows !== next.onUpdateRows ||
      prev.onRenameTeam !== next.onRenameTeam ||
      prev.onRemoveTeam !== next.onRemoveTeam ||
      prev.setConfirm !== next.setConfirm ||
      prev.setMenu !== next.setMenu ||
      prev.onCopyTeamInfo !== next.onCopyTeamInfo
    ) {
      return false;
    }
    if (prev.rows.length !== next.rows.length) return false;

    for (let i = 0; i < prev.rows.length; i++) {
      const r1 = prev.rows[i];
      const r2 = next.rows[i];
      // Lengths matched above, so a hole here would be a sparse array; treat it
      // as "changed" and re-render rather than silently comparing nothing.
      if (!r1 || !r2) return false;
      if (
        r1.updatedAt !== r2.updatedAt ||
        r1.queuedAt !== r2.queuedAt ||
        r1.id !== r2.id ||
        r1.name !== r2.name ||
        r1.role !== r2.role ||
        r1.contact !== r2.contact ||
        r1.timeWindow !== r2.timeWindow
      ) {
        return false;
      }
    }

    return true;
  },
);
