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
import { getReminderAlarmSource } from '../services/reminderAlarmSoundService';
import {
  dispatchReminderAlertLoad,
  hasLoadableReminderAlert,
} from '../services/reminderAlertLoadEvent';

const POLL_INTERVAL_MS = 30_000;
const SNOOZE_MS = 10 * 60_000;
const FALLBACK_ALARM_REPEAT_MS = 1_500;
const REMINDER_ALARM_GAIN = 0.38;
const REMINDER_ALARM_PULSES = [
  { frequency: 880, offset: 0 },
  { frequency: 1175, offset: 0.18 },
  { frequency: 740, offset: 0.36 },
  { frequency: 988, offset: 0.54 },
];

function getReminderEffectiveTime(reminder: AlertReminderRecord): number {
  const timestamp = new Date(reminder.snoozeUntil || reminder.dueAt).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function stopReminderAudio(audio: HTMLAudioElement): void {
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // Audio may throw if it is torn down while the reminder is closing.
  }
}

async function startReminderMp3Alarm(): Promise<HTMLAudioElement> {
  const audio = new Audio(getReminderAlarmSource());
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 1;

  try {
    await audio.play();
    return audio;
  } catch (err) {
    stopReminderAudio(audio);
    throw err;
  }
}

async function playFallbackReminderAlarm(): Promise<void> {
  void globalThis.api?.playAlertSound?.().catch(() => undefined);

  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const audio = new AudioContextCtor();
    if (audio.state === 'suspended') {
      await audio.resume();
    }

    const baseTime = audio.currentTime + 0.02;
    REMINDER_ALARM_PULSES.forEach(({ frequency, offset }) => {
      const startAt = baseTime + offset;
      const stopAt = startAt + 0.16;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(REMINDER_ALARM_GAIN, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(stopAt);
    });

    window.setTimeout(() => void Promise.resolve(audio.close()).catch(() => undefined), 1_200);
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

export function AlertReminderManager() {
  const { showToast } = useToast();
  const [current, setCurrent] = useState<AlertReminderRecord | null>(null);
  const currentRef = useRef<AlertReminderRecord | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const activeAlarmIdRef = useRef<string | null>(null);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
  const fallbackIntervalRef = useRef<number | null>(null);
  const chimedIdsRef = useRef(new Set<string>());
  const mutedUntilRef = useRef(new Map<string, number>());

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const refreshDue = useCallback(async () => {
    try {
      const now = Date.now();
      const dueReminders = (await listDueAlertReminders()).filter((reminder) => {
        if (getReminderEffectiveTime(reminder) > now) return false;
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

  const stopReminderAlarm = useCallback(() => {
    activeAlarmIdRef.current = null;

    if (fallbackIntervalRef.current !== null) {
      window.clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }

    if (alarmAudioRef.current) {
      stopReminderAudio(alarmAudioRef.current);
      alarmAudioRef.current = null;
    }
  }, []);

  const startRepeatingFallbackAlarm = useCallback(() => {
    if (fallbackIntervalRef.current !== null) return;

    void playFallbackReminderAlarm();
    fallbackIntervalRef.current = window.setInterval(
      () => void playFallbackReminderAlarm(),
      FALLBACK_ALARM_REPEAT_MS,
    );
  }, []);

  useEffect(() => {
    void refreshDue();
    const intervalId = window.setInterval(() => void refreshDue(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshDue]);

  useEffect(() => {
    if (!current) {
      stopReminderAlarm();
      return;
    }

    if (activeAlarmIdRef.current && activeAlarmIdRef.current !== current.id) {
      stopReminderAlarm();
    }

    if (chimedIdsRef.current.has(current.id)) return;
    chimedIdsRef.current.add(current.id);
    activeAlarmIdRef.current = current.id;

    void startReminderMp3Alarm()
      .then((audio) => {
        if (activeAlarmIdRef.current === current.id) {
          alarmAudioRef.current = audio;
          return;
        }
        stopReminderAudio(audio);
      })
      .catch(() => {
        if (activeAlarmIdRef.current === current.id) {
          startRepeatingFallbackAlarm();
        }
      });
  }, [current, startRepeatingFallbackAlarm, stopReminderAlarm]);

  useEffect(() => stopReminderAlarm, [stopReminderAlarm]);

  useEffect(() => {
    if (!current) return;
    const firstAction = dialogRef.current?.querySelector<HTMLElement>('button');
    firstAction?.focus();
  }, [current]);

  useEffect(() => {
    if (!current) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      let nextFocus: HTMLElement | null = null;
      if (!dialogRef.current?.contains(document.activeElement)) {
        nextFocus = first;
      } else if (event.shiftKey && document.activeElement === first) {
        nextFocus = last;
      } else if (!event.shiftKey && document.activeElement === last) {
        nextFocus = first;
      }

      if (nextFocus) {
        event.preventDefault();
        nextFocus.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [current]);

  const handleSnooze = async () => {
    const reminder = currentRef.current;
    if (!reminder) return;
    const snoozeUntil = Date.now() + SNOOZE_MS;
    try {
      await snoozeAlertReminder(reminder.id, new Date(snoozeUntil).toISOString());
      chimedIdsRef.current.delete(reminder.id);
      mutedUntilRef.current.set(reminder.id, snoozeUntil);
      stopReminderAlarm();
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to snooze alarm', 'error');
    }
  };

  const handleLoadAlert = async () => {
    const reminder = currentRef.current;
    if (!reminder || !hasLoadableReminderAlert(reminder)) return;
    dispatchReminderAlertLoad(reminder);
    try {
      await dismissAlertReminder(reminder.id);
      stopReminderAlarm();
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to dismiss alarm', 'error');
    }
  };

  const handleDone = async () => {
    const reminder = currentRef.current;
    if (!reminder) return;
    try {
      await markAlertReminderDone(reminder.id);
      stopReminderAlarm();
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to complete alarm', 'error');
    }
  };

  const handleDismiss = async () => {
    const reminder = currentRef.current;
    if (!reminder) return;
    try {
      await dismissAlertReminder(reminder.id);
      stopReminderAlarm();
      setCurrent(null);
      void refreshDue();
    } catch {
      showToast('Failed to dismiss alarm', 'error');
    }
  };

  if (!current) return null;

  return (
    <div
      className="alert-reminder-due-overlay alert-reminder-due-overlay--critical"
      data-testid="critical-reminder-overlay"
    >
      <div
        ref={dialogRef}
        className="alert-reminder-due alert-reminder-due--critical"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="due-reminder-title"
      >
        <div className="alert-reminder-due__accent" aria-hidden="true" />
        <div className="alert-reminder-due__content">
          <div className="alert-reminder-due__eyebrow-row">
            <div className="alert-reminder-due__eyebrow">Alert alarm</div>
            <div className="alert-reminder-due__status">Due now</div>
          </div>
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
          <TactileButton variant="secondary" size="sm" onClick={() => void handleSnooze()}>
            Snooze 10m
          </TactileButton>
          {hasLoadableReminderAlert(current) && (
            <TactileButton variant="primary" size="sm" onClick={() => void handleLoadAlert()}>
              Load Alert
            </TactileButton>
          )}
          <TactileButton variant="secondary" size="sm" onClick={() => void handleDone()}>
            Mark Done
          </TactileButton>
          <TactileButton variant="ghost" size="sm" onClick={() => void handleDismiss()}>
            Dismiss
          </TactileButton>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
