import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { TactileButton } from '../../components/TactileButton';
import { type Location } from './types';

interface SaveLocationModalProps {
  location: Location | null;
  onClose: () => void;
  onSave: (name: string, isDefault: boolean) => void;
}

export const SaveLocationModal: React.FC<SaveLocationModalProps> = ({
  location,
  onClose,
  onSave,
}) => {
  const [saveName, setSaveName] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const handleSave = () => {
    if (!saveName.trim()) return;
    onSave(saveName.trim(), saveAsDefault);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Save Location" width="420px">
      <div className="weather-mini-modal-body">
        <div className="weather-mini-modal-subtitle">
          {location?.name} ({location?.latitude.toFixed(4)}, {location?.longitude.toFixed(4)})
        </div>
        <Input
          id="save-location-name-input"
          label="Name"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="e.g., HQ, Store #1234"
          autoFocus
        />
        <label className="weather-mini-modal-checkbox-label">
          <input
            type="checkbox"
            checked={saveAsDefault}
            onChange={(e) => setSaveAsDefault(e.target.checked)}
            className="weather-mini-modal-checkbox"
          />
          <span>Set as default location</span>
        </label>
        <div className="weather-mini-modal-footer">
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton onClick={handleSave} disabled={!saveName.trim()} variant="primary">
            Save
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
