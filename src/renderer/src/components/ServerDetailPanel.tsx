import React from 'react';
import { Server, Contact } from '@shared/ipc';
import { getPlatformLabel } from '../utils/platformLabel';
import {
  DeleteIcon,
  DetailActionButton,
  DetailField,
  DetailNotesSection,
  DetailTagsSection,
  EmailText,
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
  const osLabel = getPlatformLabel(server.os);
  const ownerContact = server.owner ? contactLookup.get(server.owner.toLowerCase()) : undefined;
  const supportContact = server.contact
    ? contactLookup.get(server.contact.toLowerCase())
    : undefined;

  return (
    <div className="detail-panel">
      <div className="detail-panel-body">
        <div className="detail-panel-identity">
          <div className="detail-panel-avatar">
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
          <span className="detail-panel-os-badge">{osLabel}</span>
        </div>

        <div className="detail-panel-fields">
          {server.businessArea && (
            <DetailField
              label="Business area"
              value={server.businessArea}
              valueClassName="break-word"
            />
          )}
          {server.lob && (
            <DetailField label="Line of business" value={server.lob} valueClassName="break-word" />
          )}
          {server.comment && server.comment !== '-' && (
            <DetailField label="Comment" value={server.comment} valueClassName="break-word" />
          )}
        </div>

        <div className="detail-panel-fields">
          <PersonField label="Owner" email={server.owner} contact={ownerContact} />
          <PersonField label="Support" email={server.contact} contact={supportContact} />
        </div>

        <DetailTagsSection tags={tags} />

        <DetailNotesSection noteText={noteText} />
      </div>

      <div className="detail-panel-actions">
        <DetailActionButton
          label={noteText ? 'Edit Notes' : 'Add Notes'}
          onClick={onEditNotes}
          icon={<NotesIcon />}
        />
        <DetailActionButton
          label="Edit"
          accessibleLabel="Edit Server"
          onClick={onEdit}
          icon={<EditIcon />}
        />
        <DetailActionButton
          label="Delete"
          accessibleLabel="Delete Server"
          onClick={onDelete}
          icon={<DeleteIcon />}
          variant="danger"
        />
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
  const nameIsEmail = name.toLowerCase() === email.toLowerCase();
  return (
    <div className="detail-panel-field">
      <div className="detail-panel-field-label">{label}</div>
      {nameIsEmail ? (
        <div className="detail-panel-field-value detail-panel-email">
          <EmailText email={email} />
        </div>
      ) : (
        <>
          <div className="detail-panel-field-value">{name}</div>
          {/* The sub line only earns its place when it adds an identifier the name doesn't. */}
          <div className="detail-panel-field-sub detail-panel-email">
            <EmailText email={email} />
          </div>
        </>
      )}
    </div>
  );
};
