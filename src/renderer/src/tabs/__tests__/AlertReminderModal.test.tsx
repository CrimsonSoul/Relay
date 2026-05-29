import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertReminderModal } from '../AlertReminderModal';
import type { AlertReminderRecord } from '../../services/alertReminderService';

vi.mock('../../components/Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) => (isOpen ? <div data-testid={`modal-${title}`}>{children}</div> : null),
}));

vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: 'submit' | 'button';
  }) => (
    <button type={type ?? 'button'} onClick={onClick}>
      {children}
    </button>
  ),
}));

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

describe('AlertReminderModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T19:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefills title from the draft subject', () => {
    render(
      <AlertReminderModal
        isOpen
        onClose={vi.fn()}
        onSchedule={vi.fn()}
        draft={{
          severity: 'ISSUE',
          subject: 'POS outage',
          bodyHtml: '<p>Body</p>',
          sender: 'IT',
        }}
      />,
    );

    expect(screen.getByLabelText('Title')).toHaveValue('POS outage');
  });

  it('validates that the selected time is in the future', () => {
    const onSchedule = vi.fn();
    render(
      <AlertReminderModal
        isOpen
        onClose={vi.fn()}
        onSchedule={onSchedule}
        draft={{ severity: 'INFO', subject: '', bodyHtml: '', sender: '' }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2026-05-28T14:00' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Schedule reminder' }));

    expect(screen.getByText('Choose a future reminder time.')).toBeInTheDocument();
    expect(onSchedule).not.toHaveBeenCalled();
  });

  it('uses the next local minute as the minimum selectable time', () => {
    vi.setSystemTime(new Date('2026-05-28T19:30:30.000Z'));

    render(
      <AlertReminderModal
        isOpen
        onClose={vi.fn()}
        onSchedule={vi.fn()}
        draft={{ severity: 'INFO', subject: '', bodyHtml: '', sender: '' }}
      />,
    );

    const input = screen.getByLabelText('Date and time');
    const minTime = new Date(input.getAttribute('min') || '').getTime();

    expect(minTime).toBeGreaterThan(Date.now());
    expect(minTime - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('keeps the untouched default reminder time in the future while open', () => {
    render(
      <AlertReminderModal
        isOpen
        onClose={vi.fn()}
        onSchedule={vi.fn()}
        draft={{ severity: 'INFO', subject: '', bodyHtml: '', sender: '' }}
      />,
    );

    const input = screen.getByLabelText('Date and time') as HTMLInputElement;
    const initialValue = input.value;

    act(() => {
      vi.advanceTimersByTime(31 * 60_000);
    });

    expect(input.value).not.toBe(initialValue);
    expect(new Date(input.value).getTime()).toBeGreaterThan(Date.now());
  });

  it('submits normalized reminder context', async () => {
    const onSchedule = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <AlertReminderModal
        isOpen
        onClose={onClose}
        onSchedule={onSchedule}
        draft={{
          severity: 'MAINTENANCE',
          subject: 'Maintenance window',
          bodyHtml: '<p>Window details</p>',
          sender: 'Operations',
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2026-05-28T20:15' },
    });
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'Send before the window starts' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Schedule reminder' }));

    await vi.waitFor(() => {
      expect(onSchedule).toHaveBeenCalledWith({
        title: 'Maintenance window',
        note: 'Send before the window starts',
        dueAt: new Date('2026-05-28T20:15').toISOString(),
        severity: 'MAINTENANCE',
        alertSubject: 'Maintenance window',
        alertBodyHtml: '<p>Window details</p>',
        createdBy: 'Operations',
      });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prefills edit mode from the reminder and submits editable fields only', async () => {
    const onSchedule = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    render(
      <AlertReminderModal
        isOpen
        mode="edit"
        reminder={makeReminder({
          title: 'Existing reminder',
          note: 'Existing note',
          snoozeUntil: '2026-05-28T20:10:00.000Z',
        })}
        onClose={onClose}
        onSchedule={onSchedule}
        draft={{ severity: 'INFO', subject: '', bodyHtml: '', sender: '' }}
      />,
    );

    expect(screen.getByTestId('modal-Edit Reminder')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Existing reminder');
    expect(screen.getByLabelText('Note')).toHaveValue('Existing note');

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Updated reminder' },
    });
    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2026-05-28T21:15' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit reminder' }));

    await vi.waitFor(() => {
      expect(onSchedule).toHaveBeenCalledWith({
        title: 'Updated reminder',
        note: 'Existing note',
        dueAt: new Date('2026-05-28T21:15').toISOString(),
      });
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('validates that an edited reminder time is in the future', () => {
    const onSchedule = vi.fn();

    render(
      <AlertReminderModal
        isOpen
        mode="edit"
        reminder={makeReminder()}
        onClose={vi.fn()}
        onSchedule={onSchedule}
        draft={{ severity: 'INFO', subject: '', bodyHtml: '', sender: '' }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2026-05-28T14:00' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit reminder' }));

    expect(screen.getByText('Choose a future reminder time.')).toBeInTheDocument();
    expect(onSchedule).not.toHaveBeenCalled();
  });
});
