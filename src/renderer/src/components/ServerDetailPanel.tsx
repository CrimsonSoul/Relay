import React from 'react';
import { Server, Contact } from '@shared/ipc';
import { getPlatformColor } from './shared/PersonInfo';

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
          {server.businessArea && <DetailField label="BUSINESS AREA" value={server.businessArea} />}
          {server.lob && <DetailField label="LINE OF BUSINESS" value={server.lob} />}
          {server.comment && server.comment !== '-' && (
            <DetailField label="COMMENT" value={server.comment} />
          )}
        </div>

        <div className="detail-panel-fields">
          <PersonField label="OWNER" email={server.owner} contact={ownerContact} />
          <PersonField label="SUPPORT" email={server.contact} contact={supportContact} />
        </div>

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
            Edit Server
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
    <div className="detail-panel-field-value break-word">{value}</div>
  </div>
);

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
      <div className="detail-panel-field-value">{name}</div>
      {contact?.name && <div className="detail-panel-field-sub">{email}</div>}
    </div>
  );
};
