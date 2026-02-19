import React from 'react';
import { Contact } from '@shared/ipc';
import { AMBER } from '../utils/colors';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { GroupPill, getInitials } from './shared/AvatarUtils';

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

const isValidName = (name: string) => name && name.replace(/[.\s\-_]/g, '').length > 0;

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

        {tags.length > 0 && (
          <div className="detail-panel-section">
            <div className="detail-panel-section-label">TAGS</div>
            <div className="detail-panel-tags">
              {tags.map((tag) => (
                <span key={tag} className="detail-panel-tag">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {noteText && (
          <div className="detail-panel-section">
            <div className="detail-panel-section-label">NOTES</div>
            <div className="detail-panel-note">{noteText}</div>
          </div>
        )}

        <div className="detail-panel-actions">
          {onAddToAssembler && (
            <button
              className="detail-panel-action-btn detail-panel-action-btn--primary"
              onClick={onAddToAssembler}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add to Composer
            </button>
          )}
          <button className="detail-panel-action-btn" onClick={onEditNotes}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            {noteText ? 'Edit Notes' : 'Add Notes'}
          </button>
          <button className="detail-panel-action-btn" onClick={onEdit}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit Contact
          </button>
          <button
            className="detail-panel-action-btn detail-panel-action-btn--danger"
            onClick={onDelete}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailField: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="detail-panel-field">
    <div className="detail-panel-field-label">{label}</div>
    <div className="detail-panel-field-value">{value}</div>
  </div>
);
