import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Input } from './Input';
import { TactileButton } from './TactileButton';
import { Server } from '@shared/ipc';
import {
  addServer as pbAddServer,
  updateServer as pbUpdateServer,
} from '../services/serverService';

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverToEdit?: Server;
}

export const AddServerModal: React.FC<AddServerModalProps> = ({
  isOpen,
  onClose,
  serverToEdit,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    businessArea: '',
    lob: '',
    comment: '',
    owner: '',
    contact: '',
    os: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      // A failed save from an earlier open must not greet the next one.
      setSubmitError(null);
      if (serverToEdit) {
        setFormData({
          name: serverToEdit.name || '',
          businessArea: serverToEdit.businessArea || '',
          lob: serverToEdit.lob || '',
          comment: serverToEdit.comment || '',
          owner: serverToEdit.owner || '',
          contact: serverToEdit.contact || '',
          os: serverToEdit.os || '',
        });
      } else {
        setFormData({
          name: '',
          businessArea: '',
          lob: '',
          comment: '',
          owner: '',
          contact: '',
          os: '',
        });
      }
    }
  }, [isOpen, serverToEdit]);

  const handleSubmit = async () => {
    if (!formData.name) return; // Name is required

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const serverId = serverToEdit?.raw?.id;
      if (serverId) {
        await pbUpdateServer(serverId, formData);
      } else {
        await pbAddServer(formData);
      }
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange =
    (field: keyof typeof formData) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={serverToEdit ? 'Edit server' : 'Add server'}
      variant="standard"
      footer={
        <>
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={!formData.name}
            variant="primary"
          >
            {isSubmitting ? 'Saving…' : 'Save Server'}
          </TactileButton>
        </>
      }
    >
      <div className="add-server-form">
        <Input
          label="Server name (Required)"
          value={formData.name}
          onChange={handleChange('name')}
          placeholder="e.g. SRV-001"
          required
          aria-required="true"
          autoFocus
        />
        <div className="add-server-row">
          <Input
            label="Business area"
            value={formData.businessArea}
            onChange={handleChange('businessArea')}
            placeholder="e.g. Finance"
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="LOB"
            value={formData.lob}
            onChange={handleChange('lob')}
            placeholder="Line of business"
            containerStyle={{ flex: 1 }}
          />
        </div>

        <Input
          label="Comment"
          value={formData.comment}
          onChange={handleChange('comment')}
          placeholder="Notes…"
        />

        <div className="add-server-row">
          <Input
            label="LOB owner (email)"
            value={formData.owner}
            onChange={handleChange('owner')}
            placeholder="owner@…"
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="IT contact (email)"
            value={formData.contact}
            onChange={handleChange('contact')}
            placeholder="support@…"
            containerStyle={{ flex: 1 }}
          />
        </div>

        <Input
          label="OS"
          value={formData.os}
          onChange={handleChange('os')}
          placeholder="e.g. Windows"
        />

        {submitError && (
          <div className="add-server-error field-error" role="alert">
            {submitError}
          </div>
        )}
      </div>
    </Modal>
  );
};
