import React, { useEffect, useId, useRef, useState } from 'react';
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
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const confirmingRef = useRef(false);
  const messageId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!isOpen) setConfirmationError(null);
  }, [isOpen]);

  const handleConfirm = () => {
    if (confirmingRef.current) return;

    setConfirmationError(null);

    let result: void | Promise<void>;
    try {
      result = onConfirm();
    } catch (error) {
      setConfirmationError(
        error instanceof Error && error.message
          ? error.message
          : 'Unable to complete the action. Try again.',
      );
      return;
    }

    if (!result || typeof result.then !== 'function') {
      onClose();
      return;
    }

    confirmingRef.current = true;
    setIsConfirming(true);
    void result
      .then(() => onClose())
      .catch((error: unknown) => {
        setConfirmationError(
          error instanceof Error && error.message
            ? error.message
            : 'Unable to complete the action. Try again.',
        );
      })
      .finally(() => {
        confirmingRef.current = false;
        setIsConfirming(false);
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="400px"
      dismissible={!isConfirming}
      dialogProps={{
        'aria-busy': isConfirming,
        'aria-describedby': confirmationError ? `${messageId} ${errorId}` : messageId,
      }}
    >
      <div className="confirm-modal-body">
        <div id={messageId} className="confirm-modal-message">
          {message}
        </div>
        {confirmationError && (
          <div id={errorId} className="confirm-modal-error" role="alert" aria-live="assertive">
            {confirmationError}
          </div>
        )}
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
