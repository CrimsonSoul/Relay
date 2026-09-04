import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebAlarmStatus } from '../WebAlarmStatus';

vi.mock('../../hooks/useCollection', () => ({
  useCollection: () => ({
    data: [
      { id: 'due', status: 'pending', dueAt: '2020-01-01T00:00:00Z' },
      { id: 'done', status: 'done', dueAt: '2020-01-01T00:00:00Z' },
    ],
  }),
}));
afterEach(() => {
  globalThis.api = undefined;
  document.title = 'Relay';
});

it('shows overdue alarms and tells the operator when browser audio is blocked', async () => {
  globalThis.api = { playAlertSound: async () => false } as never;
  document.title = 'Relay';
  const { unmount } = render(<WebAlarmStatus />);
  expect(screen.getByText('1 overdue alarm')).toBeVisible();
  expect(document.title).toBe('(1 overdue) Relay');
  fireEvent.click(screen.getByRole('button', { name: 'Test sound' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sound blocked'));
  unmount();
  expect(document.title).toBe('Relay');
});
