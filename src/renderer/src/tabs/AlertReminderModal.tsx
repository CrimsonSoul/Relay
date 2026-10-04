import React, { useEffect, useId, useMemo, useState } from 'react';
import { Modal } from '../components/Modal';
import { TactileButton } from '../components/TactileButton';
import type { AlertReminderInput, AlertReminderRecord } from '../services/alertReminderService';
import { describeMissingAlertFields, missingAlertMessageFields, type Severity } from './alertUtils';

interface AlertReminderDraft {
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

const DEFAULT_DUE_OFFSET_MS = 30 * 60_000;

const DUE_PRESETS = [
  { label: 'In 15 min', offsetMs: 15 * 60_000 },
  { label: 'In 30 min', offsetMs: DEFAULT_DUE_OFFSET_MS },
  { label: 'In 1 hour', offsetMs: 60 * 60_000 },
  { label: 'In 4 hours', offsetMs: 4 * 60 * 60_000 },
] as const;

function getDefaultDueAt(): string {
  return toNextMinuteDatetimeLocalValue(Date.now() + DEFAULT_DUE_OFFSET_MS);
}

export const AlertReminderModal: React.FC<AlertReminderModalProps> = ({
  isOpen,
  onClose,
  onSchedule,
  draft,
  mode = 'schedule',
  reminder = null,
}) => {
  const formId = useId();
  const isEditing = mode === 'edit' && reminder !== null;
  const defaultTitle = useMemo(
    () => (isEditing ? reminder.title : draft.subject.trim() || 'Send alert'),
    [draft.subject, isEditing, reminder],
  );
  const draftMissingFields = missingAlertMessageFields(draft.subject, draft.bodyHtml);
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

    const intervalId = globalThis.setInterval(refreshTimes, 30_000);
    return () => globalThis.clearInterval(intervalId);
  }, [dueAtTouched, isOpen]);

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const dueAt = new Date(dueAtLocal);
    if (!dueAtLocal || Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      setError('Choose a future alarm time.');
      document.getElementById('alert-reminder-due')?.focus();
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
          alertSender: draft.sender.trim(),
        };

    const success = await onSchedule(payload);
    setSaving(false);
    if (success) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit alarm' : 'Schedule alarm'}
      variant="standard"
      footer={
        <>
          <TactileButton variant="secondary" onClick={onClose}>
            Cancel
          </TactileButton>
          <TactileButton variant="primary" type="submit" form={formId} loading={saving}>
            {isEditing ? 'Save' : 'Schedule Alarm'}
          </TactileButton>
        </>
      }
    >
      <form
        id={formId}
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
            data-autofocus
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
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
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${formId}-due-error` : undefined}
            onChange={(event) => {
              setDueAtTouched(true);
              setDueAtLocal(event.target.value);
              setError('');
            }}
          />
          {error && (
            <div id={`${formId}-due-error`} className="field-error" role="alert">
              {error}
            </div>
          )}
          <div className="alert-reminder-presets" role="group" aria-label="Quick alarm times">
            {DUE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="alert-reminder-preset"
                onClick={() => {
                  setDueAtTouched(true);
                  setDueAtLocal(toNextMinuteDatetimeLocalValue(Date.now() + preset.offsetMs));
                  setError('');
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
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

        {!isEditing && draftMissingFields.length > 0 && (
          <p className="alert-reminder-draft-note">
            The current draft has no {describeMissingAlertFields(draftMissingFields)}. Loading this
            alarm later restores the draft as it is now.
          </p>
        )}
      </form>
    </Modal>
  );
};
