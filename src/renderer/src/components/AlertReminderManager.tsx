import { useCallback, useEffect, useRef, useState } from 'react';
import { TactileButton } from './TactileButton';
import { useToast } from './Toast';
import {
  dismissAlertReminder,
  listDueAlertReminders,
  markAlertReminderDone,
  snoozeAlertReminder,
  type AlertReminderRecord,
} from '../services/alertReminderService';

const POLL_INTERVAL_MS = 30_000;
const SNOOZE_MS = 10 * 60_000;

function playReminderChime(): void {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const audio = new AudioContextCtor();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audio.currentTime);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.42);
    window.setTimeout(() => void Promise.resolve(audio.close()).catch(() => undefined), 600);
  } catch {
    // Visual reminder stays active when browser audio policy blocks playback.
  }
}

function chooseCurrentReminder(
  previous: AlertReminderRecord | null,
  dueReminders: AlertReminderRecord[],
): AlertReminderRecord | null {
  if (previous && dueReminders.some((reminder) => reminder.id === previous.id)) {
    return previous;
  }
  return dueReminders[0] ?? null;
}

export function AlertReminderManager({
  onOpenAlerts,
}: {
  readonly onOpenAlerts: () => void;
}) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<AlertReminderRecord | null>(null);
  const currentRef = useRef<AlertReminderRecord | null>(null);
  const chimedIdsRef = useRef(new Set<string>());
  const mutedUntilRef = useRef(new Map<string, number>());

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const refreshDue = useCallback(async () => {
    try {
      const now = Date.now();
      const dueReminders = (await listDueAlertReminders()).filter((reminder) => {
        const mutedUntil = mutedUntilRef.current.get(reminder.id);
        if (!mutedUntil || mutedUntil <= now) {
          mutedUntilRef.current.delete(reminder.id);
          return true;
        }
        return false;
      });
      setCurrent((previous) => chooseCurrentReminder(previous, dueReminders));
    } catch {
      // PocketBase connection health is surfaced elsewhere; polling retries quietly.
    }
  }, []);

  useEffect(() => {
    void refreshDue();
    const intervalId = window.setInterval(() => void refreshDue(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshDue]);

  useEffect(() => {
    if (!current || chimedIdsRef.current.has(current.id)) return;
    chimedIdsRef.current.add(current.id);
    playReminderChime();
  }, [current]);

  const handleSnooze = async () => {
    const reminder = currentRef.current;
    if (!reminder) return;
    const snoozeUntil = Date.now() + SNOOZE_MS;
    try {
      await snoozeAlertReminder(reminder.id, new Date(snoozeUntil).toISOString());
      chimedIdsRef.current.delete(reminder.id);
      mutedUntilRef.current.set(reminder.id, snoozeUntil);
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to snooze reminder', 'error');
    }
  };

  const handleDone = async () => {
    const reminder = currentRef.current;
    if (!reminder) return;
    try {
      await markAlertReminderDone(reminder.id);
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to complete reminder', 'error');
    }
  };

  const handleDismiss = async () => {
    const reminder = currentRef.current;
    if (!reminder) return;
    try {
      await dismissAlertReminder(reminder.id);
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to dismiss reminder', 'error');
    }
  };

  if (!current) return null;

  return (
    <section className="alert-reminder-due" role="alertdialog" aria-labelledby="due-reminder-title">
      <div className="alert-reminder-due__accent" aria-hidden="true" />
      <div className="alert-reminder-due__content">
        <div className="alert-reminder-due__eyebrow">Alert reminder</div>
        <h2 id="due-reminder-title" className="alert-reminder-due__title">
          {current.title}
        </h2>
        {current.note && <p className="alert-reminder-due__note">{current.note}</p>}
        <div className="alert-reminder-due__meta">
          Due{' '}
          {new Date(current.snoozeUntil || current.dueAt).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </div>
      </div>
      <div className="alert-reminder-due__actions">
        <TactileButton variant="secondary" size="sm" onClick={onOpenAlerts}>
          Open Alerts
        </TactileButton>
        <TactileButton variant="secondary" size="sm" onClick={() => void handleSnooze()}>
          Snooze 10m
        </TactileButton>
        <TactileButton variant="primary" size="sm" onClick={() => void handleDone()}>
          Mark Done
        </TactileButton>
        <TactileButton variant="ghost" size="sm" onClick={() => void handleDismiss()}>
          Dismiss
        </TactileButton>
      </div>
    </section>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
