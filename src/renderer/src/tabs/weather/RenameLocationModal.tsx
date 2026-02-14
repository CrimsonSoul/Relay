import React, { useState } from 'react';
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
          <div className="weather-mini-modal-title">Rename Location</div>
          <div className="weather-mini-modal-subtitle">
            {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
          </div>
        </div>
        <div className="weather-mini-modal-body">
          <label htmlFor="rename-location-input" className="weather-mini-modal-label">
            Name
          </label>
          <input
            id="rename-location-input"
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Location name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && renameName.trim() && handleRename()}
            className="weather-mini-modal-input"
          />
        </div>
        <div className="weather-mini-modal-footer">
          <button
            onClick={onClose}
            className="weather-mini-modal-btn weather-mini-modal-btn--cancel"
          >
            Cancel
          </button>
          <button
            onClick={handleRename}
            disabled={!renameName.trim()}
            className="weather-mini-modal-btn weather-mini-modal-btn--primary"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
};
