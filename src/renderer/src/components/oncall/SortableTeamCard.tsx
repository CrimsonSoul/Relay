import React, { useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TeamCard, type TeamRemoveConfirm } from '../personnel/TeamCard';
import { OnCallRow, Contact } from '@shared/ipc';
import { ContextMenuItem } from '../ContextMenu';

interface SortableTeamCardProps {
  /** Stable card identity (teamId) used for DnD. */
  id: string;
  team: string;
  index: number;
  rows: OnCallRow[];
  contacts: Contact[];
  onUpdateRows: (team: string, rows: OnCallRow[]) => void;
  onRenameTeam: (oldName: string, newName: string) => void;
  onRemoveTeam: (team: string) => void;
  setConfirm: (confirm: TeamRemoveConfirm | null) => void;
  setMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  onCopyTeamInfo: (team: string, rows: OnCallRow[]) => void;
  tick?: number;
  coverage?: React.ReactNode;
  disabled?: boolean;
}

export const SortableTeamCard: React.FC<SortableTeamCardProps> = ({ id, disabled, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  // The card is a focusable group (it holds its own buttons), not a dnd-kit
  // role="button"; it only borrows the sortable description while draggable.
  const dragAttributes = useMemo(
    () =>
      disabled
        ? undefined
        : {
            'aria-roledescription': attributes['aria-roledescription'],
            'aria-describedby': attributes['aria-describedby'],
          },
    [attributes, disabled],
  );

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 'var(--z-overlay)' : 'auto',
    position: 'relative',
    height: '100%', // Ensure it fills the grid cell
    touchAction: 'none', // Essential for dnd-kit on touch/pointer devices
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`oncall-sortable${isDragging ? ' oncall-sortable--dragging' : ''}`}
    >
      <TeamCard
        {...props}
        dragAttributes={dragAttributes}
        dragListeners={disabled ? undefined : listeners}
        dragActivatorRef={setActivatorNodeRef}
      />
    </div>
  );
};
