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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '14px', color: 'var(--color-text-primary)' }}>
        Are you sure you want to delete{' '}
        <span style={{ fontWeight: 600 }}>{contact?.name || contact?.email}</span>?
      </div>
      <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
        This action cannot be undone.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
        <TactileButton onClick={onClose}>Cancel</TactileButton>
        <TactileButton onClick={onConfirm} variant="danger">
          Delete Contact
        </TactileButton>
      </div>
    </div>
  </Modal>
);
