import { secureStorage } from '../utils/secureStorage';

export const DEFAULT_REMINDER_ALARM_SRC = '/audio/reminder-alarm.mp3';

const REMINDER_ALARM_SOUND_KEY = 'reminder_alarm_sound_url';

function isMp3FileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' && url.pathname.toLowerCase().endsWith('.mp3');
  } catch {
    return false;
  }
}

export function getReminderAlarmSource(): string {
  const stored = secureStorage.getItemSync<string>(REMINDER_ALARM_SOUND_KEY, '');
  return stored && isMp3FileUrl(stored) ? stored : DEFAULT_REMINDER_ALARM_SRC;
}

export function hasCustomReminderAlarmSource(): boolean {
  return getReminderAlarmSource() !== DEFAULT_REMINDER_ALARM_SRC;
}

export function getReminderAlarmLabel(): string {
  return hasCustomReminderAlarmSource() ? 'Custom MP3' : 'Default alarm';
}

export function saveReminderAlarmSource(source: string): boolean {
  if (!isMp3FileUrl(source)) return false;
  secureStorage.setItemSync(REMINDER_ALARM_SOUND_KEY, source);
  return true;
}

export function resetReminderAlarmSource(): void {
  secureStorage.removeItem(REMINDER_ALARM_SOUND_KEY);
}
