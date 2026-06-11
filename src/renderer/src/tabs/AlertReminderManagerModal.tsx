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
  alarmSoundLabel: string;
  hasCustomAlarmSound: boolean;
  onChooseAlarmSound: () => void;
  onResetAlarmSound: () => void;
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
  const effectiveTime = getReminderEffectiveDate(reminder).getTime();
  const isOverdue = !isCompleted && !Number.isNaN(effectiveTime) && effectiveTime <= Date.now();
  const rowClassName = [
    'alert-reminder-manager-row',
    isCompleted && 'alert-reminder-manager-row--completed',
    isOverdue && 'alert-reminder-manager-row--overdue',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClassName}>
      <div className="alert-reminder-manager-row-main">
        <div className="alert-reminder-manager-row-title">{reminder.title}</div>
        <div className="alert-reminder-manager-row-meta">
          <span className="alert-reminder-manager-row-time">{formatReminderTime(reminder)}</span>
          {isOverdue && (
            <span className="alert-reminder-manager-badge alert-reminder-manager-badge--overdue">
              Overdue
            </span>
          )}
          {!isCompleted && reminder.snoozeUntil && (
            <span className="alert-reminder-manager-badge">Snoozed</span>
          )}
          {isCompleted && (
            <span
              className={`alert-reminder-manager-badge ${
                reminder.status === 'done'
                  ? 'alert-reminder-manager-badge--done'
                  : 'alert-reminder-manager-badge--muted'
              }`}
            >
              {reminder.status}
            </span>
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
  alarmSoundLabel,
  hasCustomAlarmSound,
  onChooseAlarmSound,
  onResetAlarmSound,
}: Readonly<AlertReminderManagerModalProps>) {
  const [showCompleted, setShowCompleted] = useState(false);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Alarms" width="640px">
      <div className="alert-reminder-manager">
        <div className="alert-reminder-manager-toolbar">
          <label className="alert-reminder-manager-toggle">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            Show completed alarms
          </label>
          <TactileButton variant="primary" size="sm" onClick={onScheduleNew}>
            Schedule alarm
          </TactileButton>
        </div>

        <div className="alert-reminder-manager-sound">
          <div className="alert-reminder-manager-sound-label">Alarm sound: {alarmSoundLabel}</div>
          <div className="alert-reminder-manager-sound-actions">
            <TactileButton variant="secondary" size="sm" onClick={onChooseAlarmSound}>
              Choose MP3
            </TactileButton>
            {hasCustomAlarmSound && (
              <TactileButton variant="ghost" size="sm" onClick={onResetAlarmSound}>
                Use default
              </TactileButton>
            )}
          </div>
        </div>

        {loading && <div className="alert-reminder-manager-state">Loading alarms...</div>}

        {error && (
          <div className="alert-reminder-manager-error">
            <span>Could not load alarms.</span>
            <TactileButton variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </TactileButton>
          </div>
        )}

        {pendingReminders.length === 0 ? (
          <div className="alert-reminder-manager-empty">No pending alarms.</div>
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
