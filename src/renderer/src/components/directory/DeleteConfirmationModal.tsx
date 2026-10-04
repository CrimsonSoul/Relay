import React from 'react';
import { Contact } from '@shared/ipc';
import { Modal } from '../Modal';
import { TactileButton } from '../TactileButton';

interface DeleteConfirmationModalProps {
  contact: Contact | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  contact,
  onClose,
  onConfirm,
}) => {
  const name = contact?.name?.trim();
  return (
    <Modal
      isOpen={!!contact}
      onClose={onClose}
      title="Delete contact"
      variant="confirmation"
      footer={
        <>
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton onClick={onConfirm} variant="danger">
            Delete Contact
          </TactileButton>
        </>
      }
    >
      <div className="delete-confirm-body">
        <div className="delete-confirm-message">
          Delete <strong>{name || contact?.email}</strong>?
        </div>
        {/* Names repeat across teams; the email says exactly which record goes. */}
        {name && contact?.email && <div className="delete-confirm-identifier">{contact.email}</div>}
        <div className="delete-confirm-description">
          You can undo this from the notice that follows.
        </div>
      </div>
    </Modal>
  );
};
