import React from 'react';
import { Server, Contact } from '@shared/ipc';
import { getPlatformColor } from './shared/PersonInfo';
import {
  DeleteIcon,
  DetailActionButton,
  DetailField,
  DetailNotesSection,
  DetailTagsSection,
  EditIcon,
  NotesIcon,
} from './detailPanelCommon';

interface ServerDetailPanelProps {
  server: Server;
  contactLookup: Map<string, Contact>;
  noteText?: string;
  tags?: string[];
  onEditNotes: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const ServerDetailPanel: React.FC<ServerDetailPanelProps> = ({
  server,
  contactLookup,
  noteText,
  tags = [],
  onEditNotes,
  onEdit,
  onDelete,
}) => {
  const osInfo = getPlatformColor(server.os);
  const ownerContact = server.owner ? contactLookup.get(server.owner.toLowerCase()) : undefined;
  const supportContact = server.contact
    ? contactLookup.get(server.contact.toLowerCase())
    : undefined;

  return (
    <div className="detail-panel">
      <div className="detail-panel-body">
        <div className="detail-panel-identity">
          <div
            className="detail-panel-avatar detail-panel-avatar--server"
            style={{
              background: osInfo.bg,
              border: `1.5px solid ${osInfo.border}`,
              color: osInfo.text,
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
          </div>
          <div className="detail-panel-name">{server.name}</div>
          <span
            className="detail-panel-os-badge"
            style={{
              background: osInfo.bg,
              border: `1px solid ${osInfo.border}`,
              color: osInfo.text,
            }}
          >
            {osInfo.label}
          </span>
        </div>

        <div className="detail-panel-fields">
          {server.businessArea && (
            <DetailField
              label="BUSINESS AREA"
              value={server.businessArea}
              valueClassName="break-word"
            />
          )}
          {server.lob && (
            <DetailField label="LINE OF BUSINESS" value={server.lob} valueClassName="break-word" />
          )}
          {server.comment && server.comment !== '-' && (
            <DetailField label="COMMENT" value={server.comment} valueClassName="break-word" />
          )}
        </div>

        <div className="detail-panel-fields">
          <PersonField label="OWNER" email={server.owner} contact={ownerContact} />
          <PersonField label="SUPPORT" email={server.contact} contact={supportContact} />
        </div>

        <DetailTagsSection tags={tags} />

        <DetailNotesSection noteText={noteText} />

        <div className="detail-panel-actions">
          <DetailActionButton
            label={noteText ? 'Edit Notes' : 'Add Notes'}
            onClick={onEditNotes}
            icon={<NotesIcon />}
          />
          <DetailActionButton label="Edit Server" onClick={onEdit} icon={<EditIcon />} />
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

const PersonField: React.FC<{ label: string; email: string; contact?: Contact }> = ({
  label,
  email,
  contact,
}) => {
  if (!email || email === '-' || email === '0') {
    return (
      <div className="detail-panel-field">
        <div className="detail-panel-field-label">{label}</div>
        <div className="detail-panel-field-value detail-panel-field-value--empty">-</div>
      </div>
    );
  }
  const name = contact?.name || email;
  return (
    <div className="detail-panel-field">
      <div className="detail-panel-field-label">{label}</div>
      <div className="detail-panel-field-value break-word">{name}</div>
      {contact?.name && <div className="detail-panel-field-sub">{email}</div>}
    </div>
  );
};
