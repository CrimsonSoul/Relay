import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { Input } from '../../components/Input';
import { loggers } from '../../utils/logger';

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
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');

  // Reset name when initialName changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError('');
    }
  }, [isOpen, initialName]);

  const handleSave = async () => {
    if (savingRef.current) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Please enter a name');
      return;
    }
    if (existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase())) {
      setError('A group with this name already exists');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(trimmedName);
      setName('');
      setError('');
      onClose();
    } catch {
      setError('Could not save the group. Your name is preserved; try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (savingRef.current) return;
    setName('');
    setError('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      dismissible={!saving}
      onClose={handleClose}
      title={title}
      subtitle={description}
      variant="standard"
      footer={
        <>
          <TactileButton variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </TactileButton>
          <TactileButton
            variant="primary"
            disabled={saving}
            onClick={() => {
              handleSave().catch((error_) => {
                loggers.app.error('[SaveGroupModal] Failed to save group on click', {
                  error: error_,
                });
              });
            }}
          >
            Save
          </TactileButton>
        </>
      }
    >
      <div className="save-group-content">
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
            disabled={saving}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder="e.g., Network P1, Database Team"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSave().catch((error_) => {
                  loggers.app.error('[SaveGroupModal] Failed to save group on Enter', {
                    error: error_,
                  });
                });
              }
            }}
          />
          {error && (
            <p role="alert" className="save-group-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
