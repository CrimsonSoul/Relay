import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TeamCard } from '../personnel/TeamCard';
import { OnCallRow, Contact } from '@shared/ipc';
import { ContextMenuItem } from '../ContextMenu';

interface SortableTeamCardProps {
  team: string;
  index: number;
  rows: OnCallRow[];
  contacts: Contact[];
  onUpdateRows: (team: string, rows: OnCallRow[]) => void;
  onRenameTeam: (oldName: string, newName: string) => void;
  onRemoveTeam: (team: string) => void;
  setConfirm: (confirm: { team: string; onConfirm: () => void } | null) => void;
  setMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  onCopyTeamInfo: (team: string, rows: OnCallRow[]) => void;
}

export const SortableTeamCard: React.FC<SortableTeamCardProps> = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.team });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 1000 : 'auto',
    position: 'relative' as const,
    height: '100%', // Ensure it fills the grid cell
    touchAction: 'none', // Essential for dnd-kit on touch/pointer devices
    background: isDragging ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
    borderRadius: '16px',
    boxShadow: isDragging ? '0 20px 50px rgba(0,0,0,0.5), 0 0 20px rgba(37, 99, 235, 0.2)' : 'none',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TeamCard {...props} />
    </div>
  );
};
