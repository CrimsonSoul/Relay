import React, { useState } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
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
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = () => {
    const result = onConfirm();
    if (!result || typeof result.then !== 'function') {
      onClose();
      return;
    }

    setIsConfirming(true);
    void result
      .then(() => onClose())
      .catch(() => {
        // The caller owns inline failure feedback. Keep the confirmation open for retry.
      })
      .finally(() => setIsConfirming(false));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isConfirming ? () => undefined : onClose}
      title={title}
      width="400px"
    >
      <div className="confirm-modal-body">
        <div className="confirm-modal-message">{message}</div>
        <div className="confirm-modal-actions">
          <TactileButton variant="secondary" onClick={onClose} disabled={isConfirming}>
            {cancelLabel}
          </TactileButton>
          <TactileButton
            variant={isDanger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={isConfirming}
          >
            {confirmLabel}
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
