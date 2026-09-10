import React, { useState } from 'react';
import { OnCallRow, Contact } from '@shared/ipc';
import { Input } from '../Input';
import { Combobox } from '../Combobox';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatPhoneNumber } from '@shared/phoneUtils';

interface SortableEditRowProps {
  row: OnCallRow;
  contacts: Contact[];
  onUpdate: (row: OnCallRow) => void;
  onRemove: () => void;
}

export const SortableEditRow: React.FC<SortableEditRowProps> = ({
  row,
  contacts,
  onUpdate,
  onRemove,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const [isActive, setIsActive] = useState(false);

  let computeZIndex: number | 'auto' = 'auto';
  if (isDragging) computeZIndex = 1000;
  else if (isActive) computeZIndex = 100;

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative' as const,
    zIndex: computeZIndex,
    scale: isDragging ? '1.02' : '1',
    boxShadow: isDragging ? 'var(--shadow-xl)' : 'none',
    marginBottom: '8px',
  };

  const handleNameChange = (val: string) => {
    const nextRow = { ...row, name: val };
    const matches = contacts.filter((c) => c.name.toLowerCase() === val.toLowerCase());
    const match = matches.length === 1 ? matches[0] : undefined;
    // A directory match always takes over the phone field — including when the
    // contact has no number on record. Leaving the old value would pair the new
    // person's name with the previous person's number on the on-call board.
    if (match) nextRow.contact = match.phone ? formatPhoneNumber(match.phone) : '';
    onUpdate(nextRow);
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="sortable-edit-row-grid">
        <div {...attributes} {...listeners} className="sortable-edit-row-handle">
          ⋮⋮
        </div>
        <div className="sortable-edit-row-field">
          <Combobox
            value={row.role}
            onChange={(val) => onUpdate({ ...row, role: val })}
            options={[
              { label: 'Primary', value: 'Primary' },
              { label: 'Backup', value: 'Backup' },
              { label: 'Backup/Weekend', value: 'Backup/Weekend' },
              { label: 'Weekend', value: 'Weekend' },
              { label: 'Network', value: 'Network' },
              { label: 'Telecom', value: 'Telecom' },
              { label: 'Member', value: 'Member' },
            ]}
            placeholder="Role"
            className="sortable-edit-row-role"
            onOpenChange={setIsActive}
          />
        </div>
        <div className="sortable-edit-row-field">
          <Combobox
            value={row.name}
            onChange={handleNameChange}
            onSelectOption={(option) => {
              const match = contacts.find(
                (contact) => String(contact.raw.id || contact.email) === option.value,
              );
              if (match)
                onUpdate({
                  ...row,
                  name: match.name,
                  contact: match.phone ? formatPhoneNumber(match.phone) : '',
                });
            }}
            options={contacts.map((c) => ({
              label: c.name,
              value: String(c.raw.id || c.email),
              subLabel: c.title,
            }))}
            placeholder="Select Contact..."
            className="sortable-edit-row-name"
            onOpenChange={setIsActive}
          />
        </div>
        <Input
          value={row.contact}
          onChange={(e) => onUpdate({ ...row, contact: e.target.value })}
          onBlur={() => onUpdate({ ...row, contact: formatPhoneNumber(row.contact) })}
          placeholder="Phone"
          className="sortable-edit-row-phone"
        />
        <Input
          value={row.timeWindow || ''}
          onChange={(e) => onUpdate({ ...row, timeWindow: e.target.value })}
          placeholder="Time Window"
          className="sortable-edit-row-time"
        />
        <button
          type="button"
          aria-label="Remove row"
          className="sortable-edit-row-remove"
          onClick={onRemove}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onRemove();
            }
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
};
