import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { Input } from '../../components/Input';

type SaveGroupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void | Promise<void>;
  existingNames: string[];
  title?: string;
  description?: string;
  initialName?: string;
  contacts?: string[];
};

export const SaveGroupModal: React.FC<SaveGroupModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingNames,
  title = 'Save Group',
  description = 'Save the current selection as a reusable group.',
  initialName = '',
  contacts,
}) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');

  // Reset name when initialName changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError('');
    }
  }, [isOpen, initialName]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a name');
      return;
    }
    if (existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())) {
      setError('A group with this name already exists');
      return;
    }
    void onSave(trimmedName);
    setName('');
    setError('');
    onClose();
  };

  const handleClose = () => {
    setName('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="save-group-content">
        <h2 className="save-group-title">{title}</h2>
        <p className="save-group-description">{description}</p>

        {contacts && contacts.length > 0 && (
          <div className="save-group-contacts">
            <div className="save-group-contacts-header">
              {contacts.length} {contacts.length === 1 ? 'recipient' : 'recipients'}
            </div>
            {contacts.map((email) => (
              <div key={email} className="save-group-contacts-item">
                {email}
              </div>
            ))}
          </div>
        )}

        <div className="save-group-input-wrapper">
          <Input
            label="Group Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder="e.g., Network P1, Database Team"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
            }}
          />
          {error && <p className="save-group-error">{error}</p>}
        </div>

        <div className="save-group-actions">
          <TactileButton variant="secondary" onClick={handleClose}>
            Cancel
          </TactileButton>
          <TactileButton variant="primary" onClick={handleSave}>
            Save
          </TactileButton>
        </div>
      </div>
    </Modal>
  );
};
