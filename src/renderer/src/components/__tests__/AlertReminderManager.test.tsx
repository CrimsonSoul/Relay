import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertReminderManager } from '../AlertReminderManager';
import type { AlertReminderRecord } from '../../services/alertReminderService';

const mockListDueAlertReminders = vi.fn();
const mockSnoozeAlertReminder = vi.fn();
const mockMarkAlertReminderDone = vi.fn();
const mockDismissAlertReminder = vi.fn();
const mockPlayAlertSound = vi.fn();

vi.mock('../../services/alertReminderService', () => ({
  listDueAlertReminders: (...args: unknown[]) => mockListDueAlertReminders(...args),
  snoozeAlertReminder: (...args: unknown[]) => mockSnoozeAlertReminder(...args),
  markAlertReminderDone: (...args: unknown[]) => mockMarkAlertReminderDone(...args),
  dismissAlertReminder: (...args: unknown[]) => mockDismissAlertReminder(...args),
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T20:01:00.000Z'));
    (globalThis as unknown as { api: { playAlertSound: typeof mockPlayAlertSound } }).api = {
      playAlertSound: mockPlayAlertSound,
    };
    mockPlayAlertSound.mockResolvedValue(true);
    mockListDueAlertReminders.mockResolvedValue([]);
    mockSnoozeAlertReminder.mockResolvedValue(makeReminder());
    mockMarkAlertReminderDone.mockResolvedValue(makeReminder({ status: 'done' }));
    mockDismissAlertReminder.mockResolvedValue(makeReminder({ status: 'dismissed' }));
  });

  afterEach(() => {
    delete (globalThis as unknown as { api?: unknown }).api;
    vi.useRealTimers();
  });

  it('shows the first due reminder', async () => {
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    expect(screen.getByText('Tell the business')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('renders due reminders with the critical alarm visual treatment', async () => {
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

    render(<AlertReminderManager />);
    await flushReminderEffects();

    const overlay = screen.getByTestId('critical-reminder-overlay');
    expect(overlay).toHaveClass('alert-reminder-due-overlay--critical');
    expect(screen.getByRole('alertdialog')).toHaveClass('alert-reminder-due--critical');
    expect(screen.getByText('Due now')).toBeInTheDocument();
    expect(screen.getByText('Snooze 10m')).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByText('Mark Done')).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByText('Dismiss')).toHaveAttribute('data-variant', 'ghost');
  });

  it('defines reduced-motion styles for the critical reminder flash', () => {
    expect(componentStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(componentStyles).toContain('.alert-reminder-due-overlay--critical::before');
    expect(componentStyles).toContain('animation: none');
  });

  it('does not show reminders before their scheduled time', async () => {
    mockListDueAlertReminders.mockResolvedValue([
      makeReminder({ dueAt: '2026-05-28T20:02:00.000Z' }),
    ]);

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.queryByText('Send outage alert')).not.toBeInTheDocument();
  });

  it('plays a loud reminder alarm only once for the same visible reminder', async () => {
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
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

    render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    await flushReminderEffects();

    expect(mockPlayAlertSound).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(oscillatorStart.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(rampToValue.mock.calls.some(([value]) => typeof value === 'number' && value >= 0.3)).toBe(
      true,
    );

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(mockPlayAlertSound).toHaveBeenCalledTimes(1);
  });

  it('does not offer navigation before the reminder is addressed', async () => {
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

    render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();

    expect(screen.queryByText('Open Alerts')).not.toBeInTheDocument();
  });

  it('keeps keyboard focus inside the blocking reminder', async () => {
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

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
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

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
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

    const { rerender } = render(<AlertReminderManager />);
    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mark Done'));

    await flushReminderEffects();
    expect(mockMarkAlertReminderDone).toHaveBeenCalledWith('rem-1');

    mockListDueAlertReminders.mockResolvedValue([makeReminder({ id: 'rem-2' })]);
    rerender(<AlertReminderManager />);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    await flushReminderEffects();
    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dismiss'));

    await flushReminderEffects();
    expect(mockDismissAlertReminder).toHaveBeenCalledWith('rem-2');
  });

  it('keeps the visual reminder active when audio playback fails', async () => {
    function BlockedAudioContext() {
      throw new Error('audio blocked');
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: BlockedAudioContext,
    });
    mockListDueAlertReminders.mockResolvedValue([makeReminder()]);

    render(<AlertReminderManager />);
    await flushReminderEffects();

    expect(screen.getByText('Send outage alert')).toBeInTheDocument();
  });
});
