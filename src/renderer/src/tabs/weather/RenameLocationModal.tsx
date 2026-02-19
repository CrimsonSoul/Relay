import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { TactileButton } from '../../components/TactileButton';
import { type SavedLocation } from '@shared/ipc';

interface RenameLocationModalProps {
  location: SavedLocation;
  onClose: () => void;
  onRename: (newName: string) => void;
}

export const RenameLocationModal: React.FC<RenameLocationModalProps> = ({
  location,
  onClose,
  onRename,
}) => {
  const [renameName, setRenameName] = useState(location.name);

  const handleRename = () => {
    if (!renameName.trim()) return;
    onRename(renameName.trim());
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Rename Location" width="420px">
      <div className="weather-mini-modal-body">
        <div className="weather-mini-modal-subtitle">
          {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
        </div>
        <Input
          id="rename-location-input"
          label="Name"
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          placeholder="Location name"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && renameName.trim() && handleRename()}
        />
        <div className="weather-mini-modal-footer">
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton onClick={handleRename} disabled={!renameName.trim()} variant="primary">
            Rename
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
