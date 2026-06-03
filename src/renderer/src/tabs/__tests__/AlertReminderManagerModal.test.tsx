import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertReminderManagerModal } from '../AlertReminderManagerModal';
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
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>
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

function renderModal(
  overrides: Partial<React.ComponentProps<typeof AlertReminderManagerModal>> = {},
) {
  const props: React.ComponentProps<typeof AlertReminderManagerModal> = {
    isOpen: true,
    onClose: vi.fn(),
    pendingReminders: [],
    completedReminders: [],
    loading: false,
    error: null,
    onRetry: vi.fn(),
    onScheduleNew: vi.fn(),
    onEdit: vi.fn(),
    onDone: vi.fn(),
    onDismiss: vi.fn(),
    alarmSoundLabel: 'Default alarm',
    hasCustomAlarmSound: false,
    onChooseAlarmSound: vi.fn(),
    onResetAlarmSound: vi.fn(),
    ...overrides,
  };

  render(<AlertReminderManagerModal {...props} />);
  return props;
}

describe('AlertReminderManagerModal', () => {
  it('renders pending reminders with note previews and a snoozed indicator', () => {
    renderModal({
      pendingReminders: [
        makeReminder({ id: 'soon', title: 'Soon reminder', note: 'Short note' }),
        makeReminder({
          id: 'snoozed',
          title: 'Snoozed reminder',
          snoozeUntil: '2026-05-28T20:15:00.000Z',
        }),
      ],
    });

    expect(screen.getByTestId('modal-Alarms')).toBeInTheDocument();
    expect(screen.getByText('Soon reminder')).toBeInTheDocument();
    expect(screen.getByText('Short note')).toBeInTheDocument();
    expect(screen.getByText('Snoozed reminder')).toBeInTheDocument();
    expect(screen.getByText('Snoozed')).toBeInTheDocument();
  });

  it('hides completed reminders until the toggle is enabled', () => {
    renderModal({
      completedReminders: [
        makeReminder({ id: 'done', title: 'Finished reminder', status: 'done' }),
      ],
    });

    expect(screen.queryByText('Finished reminder')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show completed alarms'));
    expect(screen.getByText('Finished reminder')).toBeInTheDocument();
  });

  it('calls reminder actions from rows', () => {
    const props = renderModal({ pendingReminders: [makeReminder()] });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Send outage alert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done Send outage alert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Send outage alert' }));

    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'rem-1' }));
    expect(props.onDone).toHaveBeenCalledWith('rem-1');
    expect(props.onDismiss).toHaveBeenCalledWith('rem-1');
  });

  it('shows empty, loading, and error states with actions', () => {
    const props = renderModal({ loading: true, error: new Error('load failed') });

    expect(screen.getByText('Loading alarms...')).toBeInTheDocument();
    expect(screen.getByText('Could not load alarms.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    fireEvent.click(screen.getByText('Schedule alarm'));

    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(props.onScheduleNew).toHaveBeenCalledOnce();
  });

  it('shows reminder sound controls and calls selection actions', () => {
    const props = renderModal({
      alarmSoundLabel: 'Custom MP3',
      hasCustomAlarmSound: true,
    });

    expect(screen.getByText('Alarm sound: Custom MP3')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Choose MP3'));
    fireEvent.click(screen.getByText('Use default'));

    expect(props.onChooseAlarmSound).toHaveBeenCalledOnce();
    expect(props.onResetAlarmSound).toHaveBeenCalledOnce();
  });
});
