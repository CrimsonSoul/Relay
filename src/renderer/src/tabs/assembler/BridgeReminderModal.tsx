import React from 'react';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';

type BridgeReminderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export const BridgeReminderModal: React.FC<BridgeReminderModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Meeting Recording" width="400px">
      <div className="bridge-reminder-body">
        <div className="bridge-reminder-message">Please ensure meeting recording is enabled.</div>
        <div className="bridge-reminder-actions">
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton
            onClick={() => {
              onConfirm();
              onClose();
            }}
            variant="primary"
          >
            I Understand
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
