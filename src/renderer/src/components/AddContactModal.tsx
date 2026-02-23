import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { Contact } from '@shared/ipc';
import { Input } from './Input';
import { TactileButton } from './TactileButton';
import { sanitizePhoneNumber, formatPhoneNumber } from '@shared/phoneUtils';
import { loggers } from '../utils/logger';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (contact: Partial<Contact>) => void | Promise<void>;
  initialEmail?: string;
  editContact?: Contact; // If provided, we are in edit mode
};

export const AddContactModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSave,
  initialEmail = '',
  editContact,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset or populate form when opened
  useEffect(() => {
    if (isOpen) {
      if (editContact) {
        setName(editContact.name);
        setEmail(editContact.email);
        setPhone(editContact.phone);
        setTitle(editContact.title);
      } else {
        setName('');
        setEmail(initialEmail);
        setPhone('');
        setTitle('');
      }
      setIsSubmitting(false);
    }
  }, [isOpen, initialEmail, editContact]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    setIsSubmitting(true);
    try {
      await onSave({ name, email, phone: sanitizePhoneNumber(phone), title });
      onClose();
    } catch (err) {
      loggers.directory.error('[AddContactModal] Save failed', { error: err });
      // We don't close the modal so the user can see/fix the data
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneBlur = () => {
    setPhone(formatPhoneNumber(phone));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editContact ? 'Edit Contact' : 'Add Contact'}>
      <form onSubmit={handleSubmit}>
        <div className="add-contact-field">
          <Input
            label="Full Name"
            value={name}
            variant="vivid"
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alice Smith"
            required
            autoFocus
          />
        </div>

        <div className="add-contact-field">
          <Input
            label="Email Address"
            type="email"
            variant="vivid"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@example.com"
            required
          />
        </div>

        <div className="add-contact-field">
          <Input
            label="Job Title"
            variant="vivid"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Marketing Director"
          />
        </div>

        <div className="add-contact-field">
          <Input
            label="Phone Number"
            type="tel"
            variant="vivid"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={handlePhoneBlur}
            placeholder="e.g. (555) 123-4567"
          />
        </div>

        <div className="add-contact-actions">
          <TactileButton type="button" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton type="submit" disabled={isSubmitting} variant="primary">
            {isSubmitting && 'Saving...'}
            {!isSubmitting && editContact && 'Update Contact'}
            {!isSubmitting && !editContact && 'Create Contact'}
          </TactileButton>
        </div>
      </form>
    </Modal>
  );
};
