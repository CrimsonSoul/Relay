import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { createClientId } from '../utils/clientId';

interface MaintainTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamName: string;
  initialRows: OnCallRow[];
  contacts: Contact[];
  onSave: (team: string, rows: OnCallRow[], baselineIds: string[]) => void | Promise<void>;
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const baselineIdsRef = useRef<string[]>([]);
  const wasOpenRef = useRef(false);
  const teamId = useMemo(
    () => initialRows.find((row) => row.teamId)?.teamId ?? teamName.trim().toLowerCase(),
    [initialRows, teamName],
  );

  // Seed the draft only on the closed -> open transition. `initialRows` is a
  // fresh array on nearly every parent render (an empty team resolves through
  // `|| []`, and any realtime on-call change rebuilds the grouping), so keying
  // the seed on its identity silently reverted rows the operator had just added
  // — and Save then wrote the reverted set back.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setRows(initialRows.map((r) => ({ ...r })));
      baselineIdsRef.current = initialRows.map((row) => row.id);
      setSaveError('');
    }
    wasOpenRef.current = isOpen;
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
        id: createClientId(),
        team: teamName,
        teamId,
        role: 'Member',
        name: '',
        contact: '',
        timeWindow: '',
      },
    ]);
  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    const finalRows = rows.map((r) => ({
      ...r,
      team: teamName,
      teamId,
      role: r.role.trim() || 'Member',
    }));
    try {
      await onSave(teamName, finalRows, baselineIdsRef.current);
      onClose();
    } catch {
      setSaveError('Could not save changes. Your draft is preserved; try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      dismissible={!saving}
      onClose={onClose}
      title={`Edit Card: ${teamName}`}
      variant="large"
      bodyClassName="modal-body-generic--nested-scroll"
      footer={
        <>
          <TactileButton variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </TactileButton>
          <TactileButton variant="primary" onClick={handleSave} disabled={saving}>
            Save Changes
          </TactileButton>
        </>
      }
    >
      {saveError && <p role="alert">{saveError}</p>}
      <div className="maintain-team-body" inert={saving ? true : undefined}>
        <div className="maintain-team-scroll">
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
            block
            className="maintain-team-add-btn"
            onClick={handleAddRow}
          >
            + Add Row
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
