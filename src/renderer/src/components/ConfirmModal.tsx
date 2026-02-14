import React from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDanger = false,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} width="400px">
      <div className="confirm-modal-body">
        <div className="confirm-modal-message">{message}</div>
        <div className="confirm-modal-actions">
          <TactileButton variant="secondary" onClick={onClose}>
            {cancelLabel}
          </TactileButton>
          <TactileButton
            variant="primary"
            style={
              isDanger
                ? { background: 'var(--color-danger)', borderColor: 'rgba(255,0,0,0.2)' }
                : undefined
            }
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
