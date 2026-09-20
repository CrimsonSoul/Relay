import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationCenter } from './NotificationCenter';
import { NotificationProvider, useNotifications } from './NotificationProvider';

vi.mock('../../services/pocketbase', () => ({ getPb: () => ({ baseURL: 'http://center.test' }) }));
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../tickets/SdpAlerts', () => ({
  useSdpAlerts: () => ({ attention: false }),
  SdpAlertControls: () => <button>Ticket rules</button>,
}));
let state: NonNullable<ReturnType<typeof useNotifications>>;
function Capture() {
  state = useNotifications()!;
  return <NotificationCenter />;
}
function setup() {
  render(
    <NotificationProvider>
      <Capture />
    </NotificationProvider>,
  );
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('labels severity, scopes both bulk actions to the source, and offers Undo', () => {
  setup();
  act(() => {
    state.publish({
      id: 'problem',
      source: 'Problems',
      title: 'Problem event',
      message: 'Review problem',
      type: 'error',
      target: { source: 'Problems' },
    });
    state.publish({
      id: 'radar',
      source: 'Radar',
      title: 'Radar event',
      message: 'Review Radar',
      type: 'warning',
      target: { source: 'Radar' },
    });
  });
  fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
  expect(screen.getByRole('button', { name: /Problem event/ })).toHaveTextContent('Error');
  expect(screen.getByRole('button', { name: /Radar event/ })).toHaveTextContent('Warning');
  fireEvent.click(screen.getByRole('button', { name: 'Radar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark radar read' }));
  expect(state.notices.find((n) => n.id === 'problem')?.read).toBe(false);
  expect(screen.getByRole('button', { name: 'Mark radar read' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear radar' }));
  expect(screen.queryByRole('button', { name: /Radar event/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo clear' }));
  expect(screen.getByRole('button', { name: /Radar event/ })).toBeInTheDocument();
});
it('shows persistent snooze and quiet status and updates at their time boundaries', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 19, 22, 59));
  setup();
  act(() =>
    state.savePreferences({
      ...state.preferences,
      snoozeUntil: Date.now() + 30000,
      quietHoursEnabled: true,
      quietStart: '22:00',
      quietEnd: '23:00',
    }),
  );
  expect(screen.getByRole('button', { name: /Notifications.*Snoozed/ })).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(30000);
  });
  expect(screen.getByRole('button', { name: /Notifications.*Quiet hours/ })).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(30000);
  });
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
});
it('collapses per-source options and preserves times when quiet hours are toggled', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
  const summary = screen.getByText('Tickets', { selector: 'summary' });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(
    within(summary.closest('details')!).getByRole('button', { name: 'Ticket rules' }),
  ).toBeVisible();
  const toggle = screen.getByRole('checkbox', { name: 'Enable quiet hours' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '21:30' } });
  fireEvent.click(toggle);
  expect(screen.getByLabelText('Quiet hours start')).toBeDisabled();
  fireEvent.click(toggle);
  expect(screen.getByLabelText('Quiet hours start')).toHaveValue('21:30');
});
