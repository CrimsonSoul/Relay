import React from 'react';
import { Contact } from '@shared/ipc';
import { AMBER } from '../utils/colors';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { GroupPill, getInitials } from './shared/AvatarUtils';
import {
  AddIcon,
  DeleteIcon,
  DetailActionButton,
  DetailField,
  DetailNotesSection,
  DetailTagsSection,
  EditIcon,
  NotesIcon,
} from './detailPanelCommon';

interface ContactDetailPanelProps {
  contact: Contact;
  groups: string[];
  noteText?: string;
  tags?: string[];
  onEditNotes: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddToAssembler?: () => void;
}

const isValidName = (name: string) => name && name.replaceAll(/[.\s\-_]/g, '').length > 0;

export const ContactDetailPanel: React.FC<ContactDetailPanelProps> = ({
  contact,
  groups,
  noteText,
  tags = [],
  onEditNotes,
  onEdit,
  onDelete,
  onAddToAssembler,
}) => {
  const displayName = isValidName(contact.name) ? contact.name : contact.email;
  const formattedPhone = formatPhoneNumber(contact.phone || '');
  const initials = getInitials(contact.name, contact.email);

  return (
    <div className="detail-panel">
      <div className="detail-panel-body">
        <div className="detail-panel-identity">
          <div
            className="detail-panel-avatar"
            style={{
              background: AMBER.bg,
              border: `1.5px solid ${AMBER.border}`,
              color: AMBER.text,
            }}
          >
            {initials}
          </div>
          <div className="detail-panel-name">{displayName}</div>
          {contact.title && <div className="detail-panel-title">{contact.title}</div>}
        </div>

        <div className="detail-panel-fields">
          <DetailField label="EMAIL" value={contact.email} />
          {formattedPhone && <DetailField label="PHONE" value={formattedPhone} />}
        </div>

        {groups.length > 0 && (
          <div className="detail-panel-section">
            <div className="detail-panel-section-label">GROUPS</div>
            <div className="detail-panel-groups">
              {groups.map((g) => (
                <GroupPill key={g} group={g} />
              ))}
            </div>
          </div>
        )}

        <DetailTagsSection tags={tags} />

        <DetailNotesSection noteText={noteText} />

        <div className="detail-panel-actions">
          {onAddToAssembler && (
            <DetailActionButton
              label="Add to Composer"
              onClick={onAddToAssembler}
              icon={<AddIcon />}
              variant="primary"
            />
          )}
          <DetailActionButton
            label={noteText ? 'Edit Notes' : 'Add Notes'}
            onClick={onEditNotes}
            icon={<NotesIcon />}
          />
          <DetailActionButton label="Edit Contact" onClick={onEdit} icon={<EditIcon />} />
          <DetailActionButton
            label="Delete"
            onClick={onDelete}
            icon={<DeleteIcon />}
            variant="danger"
          />
        </div>
      </div>
    </div>
  );
};
