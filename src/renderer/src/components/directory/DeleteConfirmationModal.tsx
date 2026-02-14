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
}) => (
  <Modal isOpen={!!contact} onClose={onClose} title="Delete Contact" width="400px">
    <div className="delete-confirm-body">
      <div className="delete-confirm-message">
        Are you sure you want to delete <strong>{contact?.name || contact?.email}</strong>?
      </div>
      <div className="delete-confirm-description">This action cannot be undone.</div>
      <div className="delete-confirm-actions">
        <TactileButton onClick={onClose}>Cancel</TactileButton>
        <TactileButton onClick={onConfirm} variant="danger">
          Delete Contact
        </TactileButton>
      </div>
    </div>
  </Modal>
);
