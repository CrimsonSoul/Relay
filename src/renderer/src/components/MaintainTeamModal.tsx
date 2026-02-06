import React, { useState, useEffect } from 'react';
import { OnCallRow, Contact } from '@shared/ipc';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableEditRow } from './oncall/SortableEditRow';

interface MaintainTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamName: string;
  initialRows: OnCallRow[];
  contacts: Contact[];
  onSave: (team: string, rows: OnCallRow[]) => void;
}

export const MaintainTeamModal: React.FC<MaintainTeamModalProps> = ({
  isOpen,
  onClose,
  teamName,
  initialRows,
  contacts,
  onSave,
}) => {
  const [rows, setRows] = useState<OnCallRow[]>([]);

  useEffect(() => {
    if (isOpen) setRows(initialRows.map((r) => ({ ...r })));
  }, [isOpen, initialRows]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRows((items) => {
        const oldIndex = items.findIndex((r) => r.id === active.id);
        const newIndex = items.findIndex((r) => r.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleUpdate = (updated: OnCallRow) =>
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  const handleRemove = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const handleAddRow = () =>
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        team: teamName,
        role: 'Member',
        name: '',
        contact: '',
        timeWindow: '',
      },
    ]);
  const handleSave = () => {
    const finalRows = rows.map((r) => ({
      ...r,
      role: r.role.trim() || 'Member',
    }));
    onSave(teamName, finalRows);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit Card: ${teamName}`} width="960px">
      <div
        role="presentation"
        style={{ display: 'flex', flexDirection: 'column', height: '65vh' }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '10px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <DndContext
            id={`modal-dnd-${teamName}`}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {rows.map((row) => (
                <SortableEditRow
                  key={row.id}
                  row={row}
                  contacts={contacts}
                  onUpdate={handleUpdate}
                  onRemove={() => handleRemove(row.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <TactileButton
            variant="ghost"
            style={{
              width: '100%',
              marginTop: '12px',
              border: '1px dashed rgba(255,255,255,0.1)',
              opacity: 0.8,
              height: '48px',
            }}
            onClick={handleAddRow}
          >
            + Add Row
          </TactileButton>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            marginTop: '24px',
            paddingTop: '20px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <TactileButton variant="secondary" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton variant="primary" onClick={handleSave}>
            Save Changes
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
