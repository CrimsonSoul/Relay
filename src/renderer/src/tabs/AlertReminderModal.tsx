import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { TactileButton } from '../components/TactileButton';
import type { AlertReminderInput } from '../services/alertReminderService';
import type { Severity } from './alertUtils';

export interface AlertReminderDraft {
  severity: Severity;
  subject: string;
  bodyHtml: string;
  sender: string;
}

interface AlertReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSchedule: (input: AlertReminderInput) => Promise<boolean>;
  draft: AlertReminderDraft;
}

function toDatetimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function getDefaultDueAt(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 30 * 60_000));
}

export const AlertReminderModal: React.FC<AlertReminderModalProps> = ({
  isOpen,
  onClose,
  onSchedule,
  draft,
}) => {
  const defaultTitle = useMemo(() => draft.subject.trim() || 'Send alert', [draft.subject]);
  const [title, setTitle] = useState(defaultTitle);
  const [note, setNote] = useState('');
  const [dueAtLocal, setDueAtLocal] = useState(getDefaultDueAt);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(defaultTitle);
    setNote('');
    setDueAtLocal(getDefaultDueAt());
    setError('');
    setSaving(false);
  }, [defaultTitle, isOpen]);

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const dueAt = new Date(dueAtLocal);
    if (!dueAtLocal || Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      setError('Choose a future reminder time.');
      return;
    }

    setSaving(true);
    setError('');
    const success = await onSchedule({
      title: title.trim() || 'Send alert',
      note: note.trim(),
      dueAt: dueAt.toISOString(),
      severity: draft.severity,
      alertSubject: draft.subject.trim(),
      alertBodyHtml: draft.bodyHtml,
      createdBy: draft.sender.trim(),
    });
    setSaving(false);
    if (success) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Schedule Reminder" width="440px">
      <form
        className="alert-reminder-form"
        aria-label="Schedule reminder"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="alerts-field">
          <label className="alerts-field-label" htmlFor="alert-reminder-title">
            Title
          </label>
          <input
            id="alert-reminder-title"
            className="alerts-input"
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </div>

        <div className="alerts-field">
          <label className="alerts-field-label" htmlFor="alert-reminder-due">
            Date and time
          </label>
          <input
            id="alert-reminder-due"
            type="datetime-local"
            className="alerts-input alerts-input-datetime"
            value={dueAtLocal}
            min={toDatetimeLocalValue(new Date())}
            onChange={(event) => setDueAtLocal(event.target.value)}
          />
        </div>

        <div className="alerts-field">
          <label className="alerts-field-label" htmlFor="alert-reminder-note">
            Note
          </label>
          <textarea
            id="alert-reminder-note"
            className="alerts-input alert-reminder-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {error && <div className="alert-reminder-error">{error}</div>}

        <div className="alert-reminder-actions">
          <TactileButton variant="ghost" size="sm" onClick={onClose}>
            CANCEL
          </TactileButton>
          <TactileButton variant="primary" size="sm" type="submit" loading={saving}>
            SCHEDULE
          </TactileButton>
        </div>
      </form>
    </Modal>
  );
};
