import React, { useState } from 'react';
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
    <div
      className="weather-mini-modal-overlay animate-fade-in"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="weather-mini-modal animate-scale-in"
        role="presentation"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="weather-mini-modal-header">
          <div className="weather-mini-modal-title">Save Location</div>
          <div className="weather-mini-modal-subtitle">
            {location?.name} ({location?.latitude.toFixed(4)}, {location?.longitude.toFixed(4)})
          </div>
        </div>
        <div className="weather-mini-modal-body">
          <label htmlFor="save-location-name-input" className="weather-mini-modal-label">
            Name
          </label>
          <input
            id="save-location-name-input"
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="e.g., HQ, Store #1234"
            autoFocus
            className="weather-mini-modal-input"
          />
          <label className="weather-mini-modal-checkbox-label">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="weather-mini-modal-checkbox"
            />
            Set as default location
          </label>
        </div>
        <div className="weather-mini-modal-footer">
          <button
            onClick={onClose}
            className="weather-mini-modal-btn weather-mini-modal-btn--cancel"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            className="weather-mini-modal-btn weather-mini-modal-btn--primary"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
