import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  scheduleReminder: vi.fn(async () => true),
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock('../../hooks/useAlertHistory', () => ({
  useAlertHistory: () => ({
    history: [],
    addHistory: vi.fn(),
    deleteHistory: vi.fn(),
    clearHistory: vi.fn(),
    pinHistory: vi.fn(),
    updateLabel: vi.fn(),
  }),
}));

vi.mock('../../hooks/useAlertReminders', () => ({
  useAlertReminders: () => ({
    reminders: [],
    pendingReminders: [],
    completedReminders: [],
    upcomingReminders: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    scheduleReminder: mocks.scheduleReminder,
    updateReminder: vi.fn(),
    markDone: vi.fn(),
    dismissReminder: vi.fn(),
  }),
}));

vi.mock('../AlertReminderModal', () => ({
  AlertReminderModal: ({
    isOpen,
    onSchedule,
  }: {
    isOpen: boolean;
    onSchedule: (input: {
      title: string;
      note: string;
      dueAt: string;
      severity: 'INFO';
      alertSubject: string;
      alertBodyHtml: string;
      alertSender: string;
    }) => Promise<boolean>;
  }) =>
    isOpen ? (
      <section role="dialog" aria-label="Schedule Alarm">
        <button
          type="button"
          onClick={() =>
            void onSchedule({
              title: 'Provider-backed alarm',
              note: '',
              dueAt: '2026-07-14T12:00:00.000Z',
              severity: 'INFO',
              alertSubject: '',
              alertBodyHtml: '',
              alertSender: '',
            })
          }
        >
          Create provider-backed alarm
        </button>
      </section>
    ) : null,
}));

vi.mock('../AlertReminderManagerModal', () => ({
  AlertReminderManagerModal: () => null,
}));

vi.mock('../AlertHistoryModal', () => ({
  AlertHistoryModal: () => null,
}));

vi.mock('../AlertForm', () => ({
  AlertForm: () => <div>Alert form</div>,
}));

vi.mock('../AlertCard', () => ({
  AlertCard: () => <div>Alert card</div>,
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../components/Modal', () => ({
  Modal: () => null,
}));

vi.mock('../../components/StatusBar', () => ({
  StatusBar: () => null,
  StatusBarLive: () => null,
}));

vi.mock('../alertUtils', async () => ({
  ...(await vi.importActual<typeof import('../alertUtils')>('../alertUtils')),
  sanitizeHtml: (html: string) => html,
}));

import { AlertsTab } from '../AlertsTab';

describe('AlertsTab ordinary reminder integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    globalThis.api = {
      getCompanyLogo: vi.fn(async () => null),
      getFooterLogo: vi.fn(async () => null),
    } as never;
  });

  it('opens and creates an alarm without an operator provider', async () => {
    render(<AlertsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'More alert actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule Alarm' }));
    expect(screen.getByRole('dialog', { name: 'Schedule Alarm' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Create provider-backed alarm' }));

    await waitFor(() => {
      expect(mocks.scheduleReminder).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Provider-backed alarm', alertSender: '' }),
      );
    });
  });
});
