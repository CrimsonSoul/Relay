import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertReminderModal } from '../AlertReminderModal';

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
});
