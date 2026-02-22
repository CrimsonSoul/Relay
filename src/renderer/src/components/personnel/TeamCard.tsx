import React, { useMemo, useState } from 'react';
import { OnCallRow, Contact } from '@shared/ipc';
import { getColorForString } from '../../utils/colors';
import { Tooltip } from '../Tooltip';
import { MaintainTeamModal } from '../MaintainTeamModal';
import { ContextMenuItem } from '../ContextMenu';
import { TeamRow } from './TeamRow';

interface TeamCardProps {
  team: string;
  index?: number;
  rows: OnCallRow[];
  contacts: Contact[];
  onUpdateRows: (team: string, rows: OnCallRow[]) => void;
  onRenameTeam: (oldName: string, newName: string) => void;
  onRemoveTeam: (team: string) => void;
  setConfirm: (confirm: { team: string; onConfirm: () => void } | null) => void;
  setMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  onCopyTeamInfo?: (team: string, rows: OnCallRow[]) => void;
  isReadOnly?: boolean;
  tick?: number;
}

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
  }: TeamCardProps) => {
    const colorScheme = useMemo(() => getColorForString(team), [team]);
    const [isEditing, setIsEditing] = useState(false);
    const teamRows = useMemo(() => rows || [], [rows]);
    const hasAnyTimeWindow = useMemo(() => teamRows.some((r) => r.timeWindow?.trim()), [teamRows]);
    const rowGridTemplate = hasAnyTimeWindow ? 'auto 1fr auto 100px' : 'auto 1fr auto';

    const isEmpty =
      teamRows.length === 0 || (teamRows.length === 1 && !teamRows[0].name && !teamRows[0].contact);

    const getMenuItems = (): ContextMenuItem[] => {
      const copyItems = onCopyTeamInfo
        ? [
            {
              label: 'Copy On-Call Info',
              onClick: () => onCopyTeamInfo(team, teamRows),
              icon: (
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
              ),
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
          onClick: () => setConfirm({ team, onConfirm: () => onRemoveTeam(team) }),
        },
      ];
    };

    const openMenu = (x: number, y: number) => {
      setMenu({ x, y, items: getMenuItems() });
    };

    return (
      <>
        <div
          aria-label={`Team: ${team}, ${teamRows.length} members`}
          className={`card-surface team-card-body ${isReadOnly ? 'team-card-body--readonly' : 'lift-on-hover'}`}
          style={
            {
              '--team-color': colorScheme.text,
              '--team-color-fill': colorScheme.fill,
            } as React.CSSProperties
          }
        >
          <div className="team-card-header-row">
            <div className="team-card-name" style={{ color: colorScheme.text }}>
              <Tooltip content={team}>
                <span>{team}</span>
              </Tooltip>
            </div>
            <button
              type="button"
              className="team-card-menu-btn"
              aria-label={`Open actions for ${team}`}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                openMenu(rect.left, rect.bottom + 4);
              }}
            >
              ⋮
            </button>
          </div>
          <div className="team-card-rows">
            {isEmpty ? (
              <button
                type="button"
                disabled={isReadOnly}
                onClick={() => !isReadOnly && setIsEditing(true)}
                className={`team-card-empty${isReadOnly ? ' team-card-empty--readonly' : ''}`}
              >
                {isReadOnly ? 'No personnel assigned' : 'Click to assign personnel'}
              </button>
            ) : (
              teamRows.map((row) => (
                <TeamRow
                  key={row.id}
                  row={row}
                  hasAnyTimeWindow={hasAnyTimeWindow}
                  gridTemplate={rowGridTemplate}
                  tick={tick}
                />
              ))
            )}
          </div>
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
    // Custom comparison to avoid re-render if rows content is same, even if array ref changed
    if (prev.tick !== next.tick) return false;
    if (prev.index !== next.index) return false; // Color depends on index — must re-render when position changes
    if (prev.team !== next.team) return false;
    if (prev.isReadOnly !== next.isReadOnly) return false;
    if (prev.contacts !== next.contacts) return false;
    if (prev.rows.length !== next.rows.length) return false;
    // Deep check rows - expensive? Max ~10 rows per team usually.
    for (let i = 0; i < prev.rows.length; i++) {
      const r1 = prev.rows[i],
        r2 = next.rows[i];
      if (
        r1.id !== r2.id ||
        r1.name !== r2.name ||
        r1.role !== r2.role ||
        r1.contact !== r2.contact ||
        r1.timeWindow !== r2.timeWindow
      )
        return false;
    }
    return true;
  },
);
