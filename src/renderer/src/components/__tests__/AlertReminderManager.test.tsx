import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertReminderManager } from '../AlertReminderManager';
import type { AlertReminderRecord } from '../../services/alertReminderService';
import {
  resetReminderAlarmSource,
  saveReminderAlarmSource,
} from '../../services/reminderAlarmSoundService';

const mockSnoozeAlertReminder = vi.fn();
const mockMarkAlertReminderDone = vi.fn();
const mockDismissAlertReminder = vi.fn();
const mockPlayAlertSound = vi.fn();
const mockRefetch = vi.fn().mockResolvedValue(undefined);
const mockReminderData = { current: [] as AlertReminderRecord[] };
const originalAudio = globalThis.Audio;

type MockAudioElement = {
  readonly play: ReturnType<typeof vi.fn>;
  readonly pause: ReturnType<typeof vi.fn>;
  currentTime: number;
  loop: boolean;
  preload: string;
  readonly src: string;
  volume: number;
};

const mockAudioInstances: MockAudioElement[] = [];

function installMockAudio(play: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)) {
  mockAudioInstances.length = 0;

  class MockAudio implements MockAudioElement {
    currentTime = 0;
    loop = false;
    pause = vi.fn();
    preload = '';
    volume = 1;

    constructor(public readonly src: string) {
      mockAudioInstances.push(this);
    }

    play = play;
  }

  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: MockAudio,
  });
}

vi.mock('../../services/alertReminderService', () => ({
  snoozeAlertReminder: (...args: unknown[]) => mockSnoozeAlertReminder(...args),
  markAlertReminderDone: (...args: unknown[]) => mockMarkAlertReminderDone(...args),
  dismissAlertReminder: (...args: unknown[]) => mockDismissAlertReminder(...args),
}));

vi.mock('../../hooks/useCollection', () => ({
  useCollection: () => ({
    data: mockReminderData.current,
    loading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

const showToast = vi.fn();

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('../TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    variant = 'secondary',
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button onClick={onClick} data-variant={variant}>
      {children}
    </button>
  ),
}));

const componentStyles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/components.css'),
  'utf8',
);

const makeReminder = (overrides: Partial<AlertReminderRecord> = {}): AlertReminderRecord => ({
  id: 'rem-1',
  title: 'Send outage alert',
  note: 'Tell the business',
  dueAt: '2026-05-28T20:00:00.000Z',
  status: 'pending',
  snoozeUntil: '',
  severity: 'ISSUE',
  alertSubject: 'Outage',
  alertBodyHtml: '<p>Body</p>',
  createdBy: 'IT',
  completedAt: '',
  dismissedAt: '',
  created: '2026-05-28T19:00:00.000Z',
  updated: '2026-05-28T19:00:00.000Z',
  ...overrides,
});

async function flushReminderEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AlertReminderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T20:01:00.000Z'));
    (globalThis as unknown as { api: { playAlertSound: typeof mockPlayAlertSound } }).api = {
      playAlertSound: mockPlayAlertSound,
    };
    mockPlayAlertSound.mockResolvedValue(true);
    mockReminderData.current = [];
    mockSnoozeAlertReminder.mockResolvedValue(makeReminder());
    mockMarkAlertReminderDone.mockResolvedValue(makeReminder({ status: 'done' }));
    mockDismissAlertReminder.mockResolvedValue(makeReminder({ status: 'dismissed' }));
  });

  afterEach(() => {
    delete (globalThis as unknown as { api?: unknown }).api;
    resetReminderAlarmSource();
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: originalAudio,
    });
    vi.useRealTimers();
  });

  it('shows the first due reminder', async () => {
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    expect(screen.getByText('Tell the business')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('renders due reminders with the critical alarm visual treatment', async () => {
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    const overlay = screen.getByTestId('critical-reminder-overlay');
    expect(overlay).toHaveClass('alert-reminder-due-overlay--critical');
    expect(screen.getByRole('alertdialog')).toHaveClass('alert-reminder-due--critical');
    expect(screen.getByText('Due now')).toBeInTheDocument();
    expect(screen.getByText('Snooze 10m')).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByText('Load Alert')).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByText('Mark Done')).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByText('Dismiss')).toHaveAttribute('data-variant', 'ghost');
  });

  it('defines reduced-motion styles for the critical reminder flash', () => {
    expect(componentStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(componentStyles).toContain('.alert-reminder-due-overlay--critical::before');
    expect(componentStyles).toContain('animation: none');
  });

  it('does not show reminders before their scheduled time', async () => {
    mockReminderData.current = [makeReminder({ dueAt: '2026-05-28T20:02:00.000Z' })];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.queryByText('Send outage alert')).not.toBeInTheDocument();
  });

  it('uses one exact timeout instead of a 30-second polling interval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockReminderData.current = [makeReminder({ dueAt: '2026-05-28T20:02:00.000Z' })];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(screen.queryByText('Send outage alert')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
  });

  it('reconciles the shared snapshot when the window resumes', async () => {
    render(<AlertReminderManager />);
    await flushReminderEffects();

    fireEvent.focus(window);
    await flushReminderEffects();

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('loops a bundled reminder mp3 while visible and stops when addressed', async () => {
    installMockAudio();
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    await flushReminderEffects();

    expect(mockAudioInstances).toHaveLength(1);
    const audio = mockAudioInstances[0];
    expect(audio?.src).toContain('/audio/reminder-alarm.mp3');
    expect(audio?.loop).toBe(true);
    expect(audio?.preload).toBe('auto');
    expect(audio?.volume).toBe(1);
    expect(audio?.play).toHaveBeenCalledTimes(1);
    expect(mockPlayAlertSound).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(audio?.play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Dismiss'));
    await flushReminderEffects();

    expect(mockDismissAlertReminder).toHaveBeenCalledWith('rem-1');
    expect(audio?.pause).toHaveBeenCalledTimes(1);
    expect(audio?.currentTime).toBe(0);
  });

  it('loops the selected custom mp3 when one is saved', async () => {
    installMockAudio();
    saveReminderAlarmSource('file:///Users/ryan/Music/custom-alarm.mp3');
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();
    await flushReminderEffects();

    expect(mockAudioInstances).toHaveLength(1);
    expect(mockAudioInstances[0]?.src).toBe('file:///Users/ryan/Music/custom-alarm.mp3');
    expect(mockAudioInstances[0]?.loop).toBe(true);
    expect(mockAudioInstances[0]?.play).toHaveBeenCalledTimes(1);
  });

  it('repeats the fallback alarm when mp3 playback fails', async () => {
    installMockAudio(vi.fn().mockRejectedValue(new Error('mp3 blocked')));
    const oscillatorStart = vi.fn();
    const rampToValue = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined);
    function MockAudioContext() {
      return {
        state: 'suspended',
        currentTime: 0,
        resume,
        createOscillator: () => ({
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: oscillatorStart,
          stop: vi.fn(),
        }),
        createGain: () => ({
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: rampToValue,
          },
          connect: vi.fn(),
        }),
        destination: {},
        close: vi.fn().mockResolvedValue(undefined),
      };
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    });
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    await flushReminderEffects();

    expect(mockPlayAlertSound).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(oscillatorStart.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(
      rampToValue.mock.calls.some(([value]) => typeof value === 'number' && value >= 0.3),
    ).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPlayAlertSound).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText('Dismiss'));
    await flushReminderEffects();

    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
    });

    expect(mockPlayAlertSound).toHaveBeenCalledTimes(2);
  });

  it('loads the attached alert from a due reminder and dismisses the popup', async () => {
    installMockAudio();
    const loadListener = vi.fn();
    window.addEventListener('relay:load-alert-reminder', loadListener as EventListener);
    mockReminderData.current = [
      makeReminder({
        alertSubject: 'Stored outage alert',
        alertBodyHtml: '<p>Stored body</p>',
        createdBy: 'Ops',
      }),
    ];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    fireEvent.click(screen.getByText('Load Alert'));
    await flushReminderEffects();

    expect(loadListener).toHaveBeenCalledTimes(1);
    const event = loadListener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toMatchObject({
      reminderId: 'rem-1',
      title: 'Send outage alert',
      subject: 'Stored outage alert',
      bodyHtml: '<p>Stored body</p>',
      sender: 'Ops',
      severity: 'ISSUE',
    });
    expect(mockDismissAlertReminder).toHaveBeenCalledWith('rem-1');
    expect(mockSnoozeAlertReminder).not.toHaveBeenCalled();
    expect(screen.queryByText('Send outage alert')).not.toBeInTheDocument();

    window.removeEventListener('relay:load-alert-reminder', loadListener as EventListener);
  });

  it('does not offer navigation before the reminder is addressed', async () => {
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();

    expect(screen.queryByText('Open Alerts')).not.toBeInTheDocument();
  });

  it('keeps keyboard focus inside the blocking reminder', async () => {
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    const dialog = screen.getByRole('alertdialog');
    const snooze = screen.getByText('Snooze 10m');
    const dismiss = screen.getByText('Dismiss');

    expect(snooze).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dismiss).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(snooze).toHaveFocus();
  });

  it('snoozes for ten minutes and hides the reminder', async () => {
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Snooze 10m'));

    await flushReminderEffects();
    expect(mockSnoozeAlertReminder).toHaveBeenCalledWith(
      'rem-1',
      new Date('2026-05-28T20:11:00.000Z').toISOString(),
    );
    expect(screen.queryByText('Send outage alert')).not.toBeInTheDocument();
  });

  it('marks a reminder done and dismisses a reminder', async () => {
    mockReminderData.current = [makeReminder()];

    const { rerender } = render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mark Done'));

    await flushReminderEffects();
    expect(mockMarkAlertReminderDone).toHaveBeenCalledWith('rem-1');

    mockReminderData.current = [makeReminder({ id: 'rem-2' })];
    rerender(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dismiss'));

    await flushReminderEffects();
    expect(mockDismissAlertReminder).toHaveBeenCalledWith('rem-2');
  });

  it('clears chimed reminder tracking when a reminder is dismissed', async () => {
    installMockAudio();
    mockReminderData.current = [makeReminder()];

    const { rerender } = render(<AlertReminderManager />);
    await flushReminderEffects();
    await flushReminderEffects();

    expect(mockAudioInstances).toHaveLength(1);

    fireEvent.click(screen.getByText('Dismiss'));
    await flushReminderEffects();
    expect(screen.queryByText('Send outage alert')).not.toBeInTheDocument();

    mockReminderData.current = [makeReminder({ status: 'dismissed' })];
    rerender(<AlertReminderManager />);
    await flushReminderEffects();

    mockReminderData.current = [makeReminder({ updated: '2026-05-28T20:02:00.000Z' })];
    rerender(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    expect(mockAudioInstances).toHaveLength(2);
  });

  it('keeps the visual reminder active when audio playback fails', async () => {
    function BlockedAudioContext() {
      throw new Error('audio blocked');
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: BlockedAudioContext,
    });
    mockReminderData.current = [makeReminder()];

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
  });
});
