import { useEffect, useState } from 'react';
import type { AlertReminderRecord } from '../services/alertReminderService';
import { reminderEffectiveTime } from '../services/reminderScheduler';
import { useCollection } from '../hooks/useCollection';
import { TactileButton } from './TactileButton';

export function WebAlarmStatus() {
  const { data } = useCollection<AlertReminderRecord>('alert_reminders', { sort: 'dueAt' });
  const [now, setNow] = useState(Date.now);
  const [sound, setSound] = useState<'untested' | 'testing' | 'ready' | 'blocked'>('untested');
  const overdue = data.filter(
    (reminder) => reminder.status === 'pending' && reminderEffectiveTime(reminder) <= now,
  ).length;

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const audioResult = (event: Event) =>
      setSound((event as CustomEvent<boolean>).detail ? 'ready' : 'blocked');
    const timer = globalThis.setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    globalThis.addEventListener('relay-web-audio-result', audioResult);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      globalThis.removeEventListener('relay-web-audio-result', audioResult);
    };
  }, []);

  useEffect(() => {
    if (!overdue) return;
    const title = document.title;
    document.title = `(${overdue} overdue) ${title}`;
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff4539"/><path d="M16 6v13m0 5v2" stroke="#000" stroke-width="4"/></svg>')}`;
    document.head.append(icon);
    return () => {
      document.title = title;
      icon.remove();
    };
  }, [overdue]);

  const testSound = async () => {
    setSound('testing');
    try {
      setSound((await globalThis.api?.playAlertSound?.()) ? 'ready' : 'blocked');
    } catch {
      setSound('blocked');
    }
  };

  const soundLabel = {
    untested: 'Keep this tab open for alarms',
    testing: 'Testing sound…',
    ready: 'Sound available',
    blocked: 'Sound blocked — allow site audio and retry',
  }[sound];

  return (
    <span className="web-alarm-status">
      {overdue > 0 && (
        <strong>
          {overdue} overdue {overdue === 1 ? 'alarm' : 'alarms'}
        </strong>
      )}
      <output>{soundLabel}</output>
      <TactileButton
        size="sm"
        variant="ghost"
        disabled={sound === 'testing'}
        onClick={() => void testSound()}
      >
        {sound === 'testing' ? 'Testing…' : 'Test sound'}
      </TactileButton>
    </span>
  );
}
