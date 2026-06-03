import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { TactileButton } from '../components/TactileButton';
import type { AlertReminderInput, AlertReminderRecord } from '../services/alertReminderService';
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
  mode?: 'schedule' | 'edit';
  reminder?: AlertReminderRecord | null;
}

function toDatetimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toNextMinuteDatetimeLocalValue(timestampMs: number): string {
  const nextMinuteMs = (Math.floor(timestampMs / 60_000) + 1) * 60_000;
  return toDatetimeLocalValue(new Date(nextMinuteMs));
}

function getMinimumDueAt(): string {
  return toNextMinuteDatetimeLocalValue(Date.now());
}

function getDefaultDueAt(): string {
  return toNextMinuteDatetimeLocalValue(Date.now() + 30 * 60_000);
}

export const AlertReminderModal: React.FC<AlertReminderModalProps> = ({
  isOpen,
  onClose,
  onSchedule,
  draft,
  mode = 'schedule',
  reminder = null,
}) => {
  const isEditing = mode === 'edit' && reminder !== null;
  const defaultTitle = useMemo(
    () => (isEditing ? reminder.title : draft.subject.trim() || 'Send alert'),
    [draft.subject, isEditing, reminder],
  );
  const [title, setTitle] = useState(defaultTitle);
  const [note, setNote] = useState('');
  const [dueAtLocal, setDueAtLocal] = useState(getDefaultDueAt);
  const [minimumDueAtLocal, setMinimumDueAtLocal] = useState(getMinimumDueAt);
  const [dueAtTouched, setDueAtTouched] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(defaultTitle);
    setNote(isEditing ? reminder.note : '');
    setDueAtLocal(
      isEditing
        ? toDatetimeLocalValue(new Date(reminder.snoozeUntil || reminder.dueAt))
        : getDefaultDueAt(),
    );
    setMinimumDueAtLocal(getMinimumDueAt());
    setDueAtTouched(isEditing);
    setError('');
    setSaving(false);
  }, [defaultTitle, isEditing, isOpen, reminder]);

  useEffect(() => {
    if (!isOpen) return;

    const refreshTimes = () => {
      setMinimumDueAtLocal(getMinimumDueAt());
      if (!dueAtTouched) {
        setDueAtLocal(getDefaultDueAt());
      }
    };

    const intervalId = window.setInterval(refreshTimes, 30_000);
    return () => window.clearInterval(intervalId);
  }, [dueAtTouched, isOpen]);

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const dueAt = new Date(dueAtLocal);
    if (!dueAtLocal || Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      setError('Choose a future alarm time.');
      return;
    }

    setSaving(true);
    setError('');
    const payload: AlertReminderInput = isEditing
      ? {
          title: title.trim() || 'Send alert',
          note: note.trim(),
          dueAt: dueAt.toISOString(),
        }
      : {
          title: title.trim() || 'Send alert',
          note: note.trim(),
          dueAt: dueAt.toISOString(),
          severity: draft.severity,
          alertSubject: draft.subject.trim(),
          alertBodyHtml: draft.bodyHtml,
          createdBy: draft.sender.trim(),
        };

    const success = await onSchedule(payload);
    setSaving(false);
    if (success) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Alarm' : 'Schedule Alarm'}
      width="440px"
    >
      <form
        className="alert-reminder-form"
        aria-label={isEditing ? 'Edit alarm' : 'Schedule alarm'}
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
            min={minimumDueAtLocal}
            onChange={(event) => {
              setDueAtTouched(true);
              setDueAtLocal(event.target.value);
            }}
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
            {isEditing ? 'SAVE' : 'SCHEDULE'}
          </TactileButton>
        </div>
      </form>
    </Modal>
  );
};
