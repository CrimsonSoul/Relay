import React from 'react';
import { Tooltip } from './Tooltip';
import { Contact, Server } from '@shared/ipc';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { GroupPill, getInitials } from './shared/AvatarUtils';
import {
  AddIcon,
  DeleteIcon,
  DetailActionButton,
  DetailField,
  EmailText,
  DetailNotesSection,
  DetailTagsSection,
  EditIcon,
  NotesIcon,
} from './detailPanelCommon';

interface ContactDetailPanelProps {
  contact: Contact;
  groups: string[];
  relatedServers?: {
    owned: Server[];
    supported: Server[];
  };
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
  relatedServers,
  noteText,
  tags = [],
  onEditNotes,
  onEdit,
  onDelete,
  onAddToAssembler,
}) => {
  const hasName = isValidName(contact.name);
  const formattedPhone = formatPhoneNumber(contact.phone || '');
  const initials = getInitials(contact.name, contact.email);
  const hasServerRelationships =
    !!relatedServers && (relatedServers.owned.length > 0 || relatedServers.supported.length > 0);

  return (
    <div className="detail-panel">
      <div className="detail-panel-body">
        <div className="detail-panel-identity">
          <div className="detail-panel-avatar">{initials}</div>
          {hasName ? (
            <div className="detail-panel-name">{contact.name}</div>
          ) : (
            <div className="detail-panel-name detail-panel-email">
              <EmailText email={contact.email} />
            </div>
          )}
          {contact.title && <div className="detail-panel-title">{contact.title}</div>}
        </div>

        <div className="detail-panel-fields">
          <DetailField
            label="Email"
            value={<EmailText email={contact.email} />}
            valueClassName="detail-panel-email"
          />
          {formattedPhone && <DetailField label="Phone" value={formattedPhone} />}
        </div>

        {groups.length > 0 && (
          <div className="detail-panel-section">
            <div className="detail-panel-section-label">Groups</div>
            <div className="detail-panel-groups">
              {groups.map((g) => (
                <GroupPill key={g} group={g} />
              ))}
            </div>
          </div>
        )}

        <DetailTagsSection tags={tags} />

        {hasServerRelationships && (
          <div className="detail-panel-section">
            <div className="detail-panel-section-label">Server relationships</div>
            <div className="detail-panel-relationship-list">
              {relatedServers.owned.map((server) => (
                <ServerRelationshipRow
                  key={`owned-${server.name}`}
                  relationshipRole="Owner"
                  server={server}
                />
              ))}
              {relatedServers.supported.map((server) => (
                <ServerRelationshipRow
                  key={`supported-${server.name}`}
                  relationshipRole="Support"
                  server={server}
                />
              ))}
            </div>
          </div>
        )}

        <DetailNotesSection noteText={noteText} />
      </div>

      <div className="detail-panel-actions">
        {onAddToAssembler && (
          <DetailActionButton
            label="Add to Bridge"
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
        <DetailActionButton
          label="Edit"
          accessibleLabel="Edit Contact"
          onClick={onEdit}
          icon={<EditIcon />}
        />
        <DetailActionButton
          label="Delete"
          accessibleLabel="Delete Contact"
          onClick={onDelete}
          icon={<DeleteIcon />}
          variant="danger"
        />
      </div>
    </div>
  );
};

const ServerRelationshipRow: React.FC<{
  relationshipRole: 'Owner' | 'Support';
  server: Server;
}> = ({ relationshipRole, server }) => (
  <div className="detail-panel-relationship">
    <div className="detail-panel-relationship-main">
      {/* Long names ellipsize; the focusable trigger shows the full name on hover or focus. It is
          a named group so focus announces the full name once (the Tooltip's duplicate-name guard
          skips the description when its content equals the aria-label). */}
      <Tooltip content={server.name} block>
        <div // NOSONAR - labelled focusable ARIA group; <fieldset> would add form-control semantics.
          className="detail-panel-relationship-name"
          role="group"
          aria-label={server.name}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          {server.name}
        </div>
      </Tooltip>
      <div className="detail-panel-relationship-meta">
        {[server.businessArea, server.lob, server.os].filter(Boolean).join(' · ')}
      </div>
    </div>
    <span className="detail-panel-relationship-role">{relationshipRole}</span>
  </div>
);
