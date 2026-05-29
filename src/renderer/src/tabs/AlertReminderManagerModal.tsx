import React, { useState } from 'react';
import { Modal } from '../components/Modal';
import { TactileButton } from '../components/TactileButton';
import type { AlertReminderRecord } from '../services/alertReminderService';

interface AlertReminderManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingReminders: AlertReminderRecord[];
  completedReminders: AlertReminderRecord[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onScheduleNew: () => void;
  onEdit: (reminder: AlertReminderRecord) => void;
  onDone: (id: string) => void;
  onDismiss: (id: string) => void;
}

interface ReminderRowProps {
  reminder: AlertReminderRecord;
  isCompleted?: boolean;
  onEdit: (reminder: AlertReminderRecord) => void;
  onDone: (id: string) => void;
  onDismiss: (id: string) => void;
}

function getReminderEffectiveDate(reminder: AlertReminderRecord): Date {
  return new Date(reminder.snoozeUntil || reminder.dueAt);
}

function formatReminderTime(reminder: AlertReminderRecord): string {
  const date = getReminderEffectiveDate(reminder);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ReminderRow({
  reminder,
  isCompleted = false,
  onEdit,
  onDone,
  onDismiss,
}: Readonly<ReminderRowProps>) {
  return (
    <li className="alert-reminder-manager-row">
      <div className="alert-reminder-manager-row-main">
        <div className="alert-reminder-manager-row-title">{reminder.title}</div>
        <div className="alert-reminder-manager-row-meta">
          <span>{formatReminderTime(reminder)}</span>
          {reminder.snoozeUntil && <span className="alert-reminder-manager-badge">Snoozed</span>}
          {isCompleted && (
            <span className="alert-reminder-manager-badge">{reminder.status}</span>
          )}
        </div>
        {reminder.note && <div className="alert-reminder-manager-note">{reminder.note}</div>}
      </div>

      {!isCompleted && (
        <div className="alert-reminder-manager-row-actions">
          <TactileButton
            variant="ghost"
            size="sm"
            onClick={() => onEdit(reminder)}
            aria-label={`Edit ${reminder.title}`}
          >
            Edit
          </TactileButton>
          <TactileButton
            variant="secondary"
            size="sm"
            onClick={() => onDone(reminder.id)}
            aria-label={`Done ${reminder.title}`}
          >
            Done
          </TactileButton>
          <TactileButton
            variant="ghost"
            size="sm"
            onClick={() => onDismiss(reminder.id)}
            aria-label={`Dismiss ${reminder.title}`}
          >
            Dismiss
          </TactileButton>
        </div>
      )}
    </li>
  );
}

export function AlertReminderManagerModal({
  isOpen,
  onClose,
  pendingReminders,
  completedReminders,
  loading,
  error,
  onRetry,
  onScheduleNew,
  onEdit,
  onDone,
  onDismiss,
}: Readonly<AlertReminderManagerModalProps>) {
  const [showCompleted, setShowCompleted] = useState(false);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Reminders" width="640px">
      <div className="alert-reminder-manager">
        <div className="alert-reminder-manager-toolbar">
          <label className="alert-reminder-manager-toggle">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            Show completed reminders
          </label>
          <TactileButton variant="primary" size="sm" onClick={onScheduleNew}>
            Schedule reminder
          </TactileButton>
        </div>

        {loading && <div className="alert-reminder-manager-state">Loading reminders...</div>}

        {error && (
          <div className="alert-reminder-manager-error">
            <span>Could not load reminders.</span>
            <TactileButton variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </TactileButton>
          </div>
        )}

        {pendingReminders.length === 0 ? (
          <div className="alert-reminder-manager-empty">No pending reminders.</div>
        ) : (
          <ul className="alert-reminder-manager-list">
            {pendingReminders.map((reminder) => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                onEdit={onEdit}
                onDone={onDone}
                onDismiss={onDismiss}
              />
            ))}
          </ul>
        )}

        {showCompleted && completedReminders.length > 0 && (
          <div className="alert-reminder-manager-completed">
            <div className="alert-reminder-manager-section-title">Completed</div>
            <ul className="alert-reminder-manager-list">
              {completedReminders.map((reminder) => (
                <ReminderRow
                  key={reminder.id}
                  reminder={reminder}
                  isCompleted
                  onEdit={onEdit}
                  onDone={onDone}
                  onDismiss={onDismiss}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
