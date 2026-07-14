import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayOperatorRecord } from '@shared/operators';

const mocks = vi.hoisted(() => ({
  useCollection: vi.fn(),
  showToast: vi.fn(),
  scheduleReminder: vi.fn(async () => true),
}));

vi.mock('../../hooks/useCollection', () => ({
  useCollection: mocks.useCollection,
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
  AlertForm: React.forwardRef(function MockAlertForm(
    _props: Record<string, unknown>,
    ref: React.Ref<{ setEditorContent: (html: string) => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({ setEditorContent: vi.fn() }));
    return <div>Alert form</div>;
  }),
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

vi.mock('../alertUtils', () => ({
  sanitizeHtml: (html: string) => html,
}));

import { OperatorProvider } from '../../contexts/OperatorContext';
import { SidebarOperatorSelector } from '../../components/sidebar/SidebarOperatorSelector';
import { AlertsTab } from '../AlertsTab';

const operator: RelayOperatorRecord = {
  id: 'operator-alpha',
  displayName: 'Alpha Operator',
  active: true,
  created: '2026-07-13 12:00:00.000Z',
  updated: '2026-07-13 12:00:00.000Z',
};

describe('AlertsTab operator attribution integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.useCollection.mockReturnValue({
      data: [operator],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
      refetch: vi.fn(),
    });
    globalThis.api = {
      getCompanyLogo: vi.fn(async () => null),
      getFooterLogo: vi.fn(async () => null),
    } as never;
  });

  it('opens the real shared picker before a new alarm and creates from the retry snapshot', async () => {
    render(
      <OperatorProvider>
        <SidebarOperatorSelector />
        <AlertsTab />
      </OperatorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SCHEDULE ALARM' }));

    const picker = await screen.findByRole('menu', { name: 'Select operator' });
    const alpha = within(picker).getByRole('menuitemradio', { name: 'Alpha Operator' });
    expect(alpha).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Schedule Alarm' })).not.toBeInTheDocument();

    fireEvent.click(alpha);
    expect(screen.queryByRole('menu', { name: 'Select operator' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'SCHEDULE ALARM' }));
    expect(screen.getByRole('dialog', { name: 'Schedule Alarm' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Create provider-backed alarm' }));

    await waitFor(() => {
      expect(mocks.scheduleReminder).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Provider-backed alarm', alertSender: '' }),
        { operatorId: 'operator-alpha', operatorName: 'Alpha Operator' },
      );
    });
  });
});
