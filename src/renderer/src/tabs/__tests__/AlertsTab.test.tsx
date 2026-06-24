import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// --- Mocks ---

const mockCapture = vi.hoisted(() => {
  const highResCanvas = {
    width: 1280,
    height: 1200,
    toDataURL: vi.fn(() => 'data:image/png;base64,HIGH_RES_CAPTURE'),
  };
  const outlookCanvas = {
    width: 640,
    height: 600,
    toDataURL: vi.fn(() => 'data:image/png;base64,OUTLOOK_SIZED_CAPTURE'),
  };
  const html2canvas = vi.fn((_element: HTMLElement, options?: { scale?: number }) =>
    Promise.resolve(options?.scale === 1 ? outlookCanvas : highResCanvas),
  );
  return { highResCanvas, outlookCanvas, html2canvas };
});

vi.mock('html2canvas', () => ({
  default: mockCapture.html2canvas,
}));

// Mock useToast — capture showToast so tests can assert on it
const mockShowToast = vi.fn();
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Mock useAlertHistory — capture addHistory so tests can assert/resolve it
const mockAddHistory = vi.fn().mockResolvedValue({ id: '1' });
const mockDeleteHistory = vi.fn();
const mockClearHistory = vi.fn();
const mockPinHistory = vi.fn();
const mockUpdateLabel = vi.fn();
vi.mock('../../hooks/useAlertHistory', () => ({
  useAlertHistory: () => ({
    history: [],
    addHistory: mockAddHistory,
    deleteHistory: mockDeleteHistory,
    clearHistory: mockClearHistory,
    pinHistory: mockPinHistory,
    updateLabel: mockUpdateLabel,
  }),
}));

const mockScheduleReminder = vi.fn().mockResolvedValue(true);
const mockUpdateReminder = vi.fn().mockResolvedValue(true);
const mockMarkDone = vi.fn().mockResolvedValue(true);
const mockDismissReminder = vi.fn().mockResolvedValue(true);
const mockReminderRefetch = vi.fn();
const mockPendingReminders = {
  current: [] as Array<{
    id: string;
    title: string;
    dueAt: string;
    note?: string;
    status?: string;
    snoozeUntil?: string;
  }>,
};
const mockCompletedReminders = { current: [] as unknown[] };
vi.mock('../../hooks/useAlertReminders', () => ({
  useAlertReminders: () => ({
    reminders: [],
    pendingReminders: mockPendingReminders.current,
    completedReminders: mockCompletedReminders.current,
    upcomingReminders: mockPendingReminders.current,
    loading: false,
    error: null,
    refetch: mockReminderRefetch,
    scheduleReminder: mockScheduleReminder,
    snoozeReminder: vi.fn(),
    updateReminder: mockUpdateReminder,
    markDone: mockMarkDone,
    dismissReminder: mockDismissReminder,
  }),
}));

// Use a real-ish useModalState so modals can actually open/close
vi.mock('../../hooks/useModalState', () => ({
  useModalState: () => {
    const [isOpen, setIsOpen] = React.useState(false);
    return {
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((p: boolean) => !p),
    };
  },
}));

vi.mock('../AlertReminderModal', () => ({
  AlertReminderModal: (props: {
    isOpen: boolean;
    draft: { severity: string; subject: string; bodyHtml: string; sender: string };
    mode?: 'schedule' | 'edit';
    reminder?: { title: string } | null;
    onSchedule: (input: Record<string, unknown>) => Promise<boolean>;
  }) =>
    props.isOpen ? (
      <div data-testid="reminder-modal">
        <span data-testid="reminder-modal-mode">{props.mode ?? 'schedule'}</span>
        <span data-testid="reminder-edit-title">{props.reminder?.title ?? ''}</span>
        <span data-testid="reminder-draft-severity">{props.draft.severity}</span>
        <span data-testid="reminder-draft-subject">{props.draft.subject}</span>
        <span data-testid="reminder-draft-body">{props.draft.bodyHtml}</span>
        <span data-testid="reminder-draft-sender">{props.draft.sender}</span>
        <button
          data-testid="reminder-schedule"
          onClick={() => void props.onSchedule({ title: 'Scheduled reminder' })}
        >
          Schedule alarm
        </button>
      </div>
    ) : null,
}));

vi.mock('../AlertReminderManagerModal', () => ({
  AlertReminderManagerModal: (props: {
    isOpen: boolean;
    pendingReminders: Array<{ id: string; title: string }>;
    onScheduleNew: () => void;
    onEdit: (reminder: { id: string; title: string }) => void;
    onDone: (id: string) => void;
    onDismiss: (id: string) => void;
  }) =>
    props.isOpen ? (
      <div data-testid="reminder-manager-modal">
        <span data-testid="manager-count">{props.pendingReminders.length}</span>
        <button data-testid="manager-schedule" onClick={props.onScheduleNew}>
          manager-schedule
        </button>
        <button data-testid="manager-edit" onClick={() => props.onEdit(props.pendingReminders[0])}>
          manager-edit
        </button>
        <button
          data-testid="manager-done"
          onClick={() => props.onDone(props.pendingReminders[0].id)}
        >
          manager-done
        </button>
        <button
          data-testid="manager-dismiss"
          onClick={() => props.onDismiss(props.pendingReminders[0].id)}
        >
          manager-dismiss
        </button>
      </div>
    ) : null,
}));

// Mock AlertForm — forward ref and expose callbacks so we can trigger them from tests
vi.mock('../AlertForm', () => ({
  AlertForm: React.forwardRef(function MockAlertForm(
    props: Record<string, unknown>,
    ref: React.Ref<{ setEditorContent: (html: string) => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({
      setEditorContent: vi.fn(),
    }));
    const setSeverity = props.setSeverity as (s: string) => void;
    const setSubject = props.setSubject as (s: string) => void;
    const setBodyHtml = props.setBodyHtml as (s: string) => void;
    const setSender = props.setSender as (s: string) => void;
    const setRecipient = props.setRecipient as (s: string) => void;
    const setUpdateNumber = props.setUpdateNumber as (n: number) => void;
    const hasRetiredTransformProps = [
      'isCompact',
      'onToggleCompact',
      'isEnhanced',
      'onToggleEnhanced',
    ].some((key) => Object.prototype.hasOwnProperty.call(props, key));
    const hasRetiredFontSizeProps = ['alertBodyFontSize', 'setAlertBodyFontSize'].some((key) =>
      Object.prototype.hasOwnProperty.call(props, key),
    );
    return (
      <div data-testid="alert-form">
        <button data-testid="set-severity-issue" onClick={() => setSeverity('ISSUE')}>
          set-issue
        </button>
        <button data-testid="set-severity-maintenance" onClick={() => setSeverity('MAINTENANCE')}>
          set-maintenance
        </button>
        <button data-testid="set-severity-info" onClick={() => setSeverity('INFO')}>
          set-info
        </button>
        <button data-testid="set-severity-resolved" onClick={() => setSeverity('RESOLVED')}>
          set-resolved
        </button>
        <button data-testid="set-subject" onClick={() => setSubject('Test Subject')}>
          set-subject
        </button>
        <button data-testid="set-body" onClick={() => setBodyHtml('<p>body</p>')}>
          set-body
        </button>
        <button data-testid="set-sender" onClick={() => setSender('Security')}>
          set-sender
        </button>
        <button data-testid="set-recipient" onClick={() => setRecipient('Managers')}>
          set-recipient
        </button>
        <button data-testid="set-update-number" onClick={() => setUpdateNumber(2)}>
          set-update
        </button>
        <span data-testid="form-retired-transform-props">{String(hasRetiredTransformProps)}</span>
        <span data-testid="form-retired-font-size-props">{String(hasRetiredFontSizeProps)}</span>
      </div>
    );
  }),
}));

vi.mock('../AlertCard', () => ({
  AlertCard: (props: Record<string, unknown>) => {
    const severityColors: Record<string, string> = {
      ISSUE: '#d32f2f',
      MAINTENANCE: '#f9a825',
      INFO: '#1565c0',
      RESOLVED: '#2e7d32',
    };
    return (
      <div
        className="alerts-email-card"
        data-testid="alert-card"
        ref={props.cardRef as React.Ref<HTMLDivElement>}
        style={
          {
            '--email-banner': severityColors[String(props.severity)] ?? '#1565c0',
            borderColor: 'var(--email-banner)',
          } as React.CSSProperties
        }
      >
        <div className="alerts-email-severity-header" style={{ background: 'var(--email-banner)' }}>
          mock banner
        </div>
        <div className="alerts-email-icon-wrapper">
          <div className="alerts-email-icon">
            <svg data-testid="mock-alert-icon" />
          </div>
        </div>
        <div className="alerts-email-header">mock subject</div>
        <div className="alerts-email-meta">mock meta</div>
        <div className="alerts-email-body">mock body</div>
        <div className="alerts-email-footer">mock footer</div>
        <span data-testid="card-severity">{String(props.severity)}</span>
        <span data-testid="card-subject">{String(props.displaySubject)}</span>
        <span data-testid="card-sender">{String(props.displaySender)}</span>
        <span data-testid="card-recipient">{String(props.displayRecipient)}</span>
        <span data-testid="card-body">{String(props.bodyHtml)}</span>
        <span data-testid="card-retired-font-size-prop">
          {String(Object.prototype.hasOwnProperty.call(props, 'alertBodyFontSize'))}
        </span>
      </div>
    );
  },
}));

// Mock AlertHistoryModal — render load button when open
vi.mock('../AlertHistoryModal', () => ({
  AlertHistoryModal: (props: {
    isOpen: boolean;
    onLoad: (entry: Record<string, unknown>) => void;
    onDelete: (id: string) => void;
    onClear: () => void;
  }) =>
    props.isOpen ? (
      <div data-testid="history-modal">
        <button
          data-testid="history-load"
          onClick={() =>
            props.onLoad({
              severity: 'MAINTENANCE',
              subject: 'Loaded Subject',
              bodyHtml: '<p>loaded</p>',
              sender: 'Ops',
              recipient: 'Staff',
            })
          }
        >
          Load
        </button>
        <button data-testid="history-delete" onClick={() => props.onDelete('del-1')}>
          Delete
        </button>
        <button data-testid="history-clear" onClick={() => props.onClear()}>
          Clear
        </button>
      </div>
    ) : null,
}));

vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    loading,
    variant,
    icon,
    tooltip,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    variant?: string;
    icon?: React.ReactNode;
    tooltip?: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      disabled={loading}
      data-variant={variant}
      data-has-icon={icon ? 'true' : 'false'}
      data-tooltip={typeof tooltip === 'string' ? tooltip : undefined}
    >
      {icon && <span data-testid={`button-icon-${String(children).trim()}`}>{icon}</span>}
      {children}
    </button>
  ),
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
}));

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

vi.mock('../../components/StatusBar', () => ({
  StatusBar: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="status-bar">
      {left}
      {right}
    </div>
  ),
  StatusBarLive: () => <span data-testid="status-bar-live" />,
}));

vi.mock('../alertUtils', () => ({
  sanitizeHtml: (html: string) => html,
}));

// Stub globalThis.api
beforeEach(() => {
  vi.clearAllMocks();
  mockPendingReminders.current = [];
  mockCompletedReminders.current = [];
  (globalThis as Record<string, unknown>).api = {
    getCompanyLogo: vi.fn().mockResolvedValue(null),
    getFooterLogo: vi.fn().mockResolvedValue(null),
    writeClipboardImage: vi.fn().mockResolvedValue(true),
    optimizeAlertImage: vi.fn().mockResolvedValue({
      success: true,
      data: 'data:image/png;base64,OPTIMIZED_OUTLOOK_CAPTURE',
    }),
    saveAlertImage: vi.fn().mockResolvedValue({ success: true }),
    saveCompanyLogo: vi.fn().mockResolvedValue({ success: false }),
    removeCompanyLogo: vi.fn().mockResolvedValue({ success: true }),
    saveFooterLogo: vi.fn().mockResolvedValue({ success: false }),
    removeFooterLogo: vi.fn().mockResolvedValue({ success: true }),
  };
});

// --- Import after mocks ---
import { AlertsTab } from '../AlertsTab';

describe('AlertsTab', () => {
  it('renders without crashing', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('alert-form')).toBeInTheDocument();
    expect(screen.getByTestId('alert-card')).toBeInTheDocument();
  });

  it('renders action buttons in the header', () => {
    render(<AlertsTab />);
    expect(screen.getByText('RESET')).toBeInTheDocument();
    expect(screen.getByText('HISTORY')).toBeInTheDocument();
    expect(screen.getByText('ALARMS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'REMIND' })).not.toBeInTheDocument();
    expect(screen.getByText('PIN TEMPLATE')).toBeInTheDocument();
    expect(screen.getByText('SAVE PNG')).toBeInTheDocument();
    expect(screen.getByText('COPY FOR OUTLOOK')).toBeInTheDocument();
    expect(screen.getByText('SCHEDULE ALERT ALARM')).toBeInTheDocument();
  });

  it('places the alarm action before the Outlook copy action', () => {
    render(<AlertsTab />);
    const header = screen.getByTestId('collapsible-header');
    const labels = Array.from(header.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );

    expect(labels.indexOf('SCHEDULE ALERT ALARM')).toBeLessThan(labels.indexOf('COPY FOR OUTLOOK'));
    expect(screen.getByText('SCHEDULE ALERT ALARM')).toHaveAttribute('data-has-icon', 'true');
    expect(screen.getByText('SCHEDULE ALERT ALARM')).toHaveAttribute(
      'data-tooltip',
      'Schedule an alarm for this alert',
    );
  });

  it('shows default sender and recipient on the alert card', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('card-sender')).toHaveTextContent('IT');
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('All Employees');
  });

  it('shows default severity as INFO', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('card-severity')).toHaveTextContent('INFO');
  });

  it('shows default subject placeholder', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Alert Subject');
  });

  it('renders status bar with Alert Composer label', () => {
    render(<AlertsTab />);
    expect(screen.getByText('Alert Composer')).toBeInTheDocument();
  });

  it('does not show history modal by default', () => {
    render(<AlertsTab />);
    expect(screen.queryByTestId('history-modal')).not.toBeInTheDocument();
  });

  it('does not show pin template modal by default', () => {
    render(<AlertsTab />);
    expect(screen.queryByTestId('modal-Pin Template')).not.toBeInTheDocument();
  });

  it('displays update number prefix in subject when updateNumber > 0', () => {
    // The AlertCard mock receives displaySubject which is computed from updateNumber
    // Default state has updateNumber 0, so subject should be 'Alert Subject'
    render(<AlertsTab />);
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Alert Subject');
    // No "UPDATE" prefix in the default state
    expect(screen.getByTestId('card-subject').textContent).not.toContain('UPDATE');
  });

  it('loads logo from api on mount', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getCompanyLogo as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,LOGO',
    );
    render(<AlertsTab />);
    // The getCompanyLogo should have been called
    expect(api.getCompanyLogo).toHaveBeenCalled();
  });

  it('loads footer logo from api on mount', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getFooterLogo as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,FLOGO',
    );
    render(<AlertsTab />);
    expect(api.getFooterLogo).toHaveBeenCalled();
  });

  it('handles logo load failure gracefully', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getCompanyLogo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    // Should not throw
    expect(() => render(<AlertsTab />)).not.toThrow();
  });

  it('handles footer logo load failure gracefully', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getFooterLogo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    expect(() => render(<AlertsTab />)).not.toThrow();
  });

  it('handles missing api gracefully', () => {
    (globalThis as Record<string, unknown>).api = undefined;
    expect(() => render(<AlertsTab />)).not.toThrow();
  });

  it('renders RESET button that is clickable', () => {
    render(<AlertsTab />);
    const resetBtn = screen.getByText('RESET');
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    // After reset, defaults should still show
    expect(screen.getByTestId('card-severity')).toHaveTextContent('INFO');
  });

  it('renders PIN TEMPLATE button that is clickable', () => {
    render(<AlertsTab />);
    const pinBtn = screen.getByText('PIN TEMPLATE');
    expect(pinBtn).toBeInTheDocument();
    fireEvent.click(pinBtn);
    // The pin modal uses useModalState which is mocked to always be closed,
    // so just verifying the click doesn't throw
    expect(pinBtn).toBeInTheDocument();
  });

  it('clicking SAVE PNG saves the high-resolution capture', async () => {
    render(<AlertsTab />);
    const saveBtn = screen.getByText('SAVE PNG');
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(globalThis.api?.saveAlertImage).toHaveBeenCalledWith(
        'data:image/png;base64,HIGH_RES_CAPTURE',
        'alert_alert.png',
      );
    });
    expect(mockCapture.html2canvas).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.objectContaining({
          minWidth: '640px',
          maxWidth: '640px',
        }),
      }),
      expect.objectContaining({ scale: 2 }),
    );
  });

  it('clicking COPY FOR OUTLOOK optimizes the high-resolution capture before writing it', async () => {
    render(<AlertsTab />);
    const copyBtn = screen.getByText('COPY FOR OUTLOOK');
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(globalThis.api?.optimizeAlertImage).toHaveBeenCalledWith(
        'data:image/png;base64,HIGH_RES_CAPTURE',
      );
      expect(globalThis.api?.writeClipboardImage).toHaveBeenCalledWith(
        'data:image/png;base64,OPTIMIZED_OUTLOOK_CAPTURE',
      );
    });
    expect(mockCapture.html2canvas).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.objectContaining({
          minWidth: '640px',
          maxWidth: '640px',
        }),
      }),
      expect.objectContaining({ scale: 2 }),
    );
  });

  it('falls back to the original high-resolution capture when Outlook optimization fails', async () => {
    vi.mocked(globalThis.api!.optimizeAlertImage!).mockResolvedValueOnce({
      success: false,
      error: 'Optimization failed',
    });

    render(<AlertsTab />);
    const copyBtn = screen.getByText('COPY FOR OUTLOOK');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(globalThis.api?.writeClipboardImage).toHaveBeenCalledWith(
        'data:image/png;base64,HIGH_RES_CAPTURE',
      );
    });
  });

  it('resolves banner colors in the shared capture clone before rendering', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));

    fireEvent.click(screen.getByText('COPY FOR OUTLOOK'));

    await waitFor(() => {
      expect(mockCapture.html2canvas).toHaveBeenCalled();
    });
    const clone = mockCapture.html2canvas.mock.calls.at(-1)?.[0] as HTMLElement;
    const header = clone.querySelector('.alerts-email-severity-header') as HTMLElement;

    expect(header.style.background).not.toContain('var(');
    expect(header.style.backgroundColor).toBe('rgb(211, 47, 47)');
    expect(clone.style.borderColor).toBe('rgb(211, 47, 47)');
  });

  it.each([
    ['ISSUE', 'set-severity-issue', 'rgb(211, 47, 47)'],
    ['MAINTENANCE', 'set-severity-maintenance', 'rgb(249, 168, 37)'],
    ['INFO', 'set-severity-info', 'rgb(21, 101, 192)'],
    ['RESOLVED', 'set-severity-resolved', 'rgb(46, 125, 50)'],
  ])(
    'resolves %s capture colors for Teams, Discord, and Outlook paste targets',
    async (_severity, testId, expectedColor) => {
      render(<AlertsTab />);
      fireEvent.click(screen.getByTestId(testId));

      fireEvent.click(screen.getByText('COPY FOR OUTLOOK'));

      await waitFor(() => {
        expect(mockCapture.html2canvas).toHaveBeenCalled();
      });
      const clone = mockCapture.html2canvas.mock.calls.at(-1)?.[0] as HTMLElement;
      const header = clone.querySelector('.alerts-email-severity-header') as HTMLElement;
      const icon = clone.querySelector('.alerts-email-icon') as HTMLElement;

      expect(header.style.backgroundColor).toBe(expectedColor);
      expect(clone.style.borderColor).toBe(expectedColor);
      expect(icon.style.borderColor).toBe(expectedColor);
    },
  );

  it('paints alert capture surfaces so Teams and Discord do not show grey transparency', async () => {
    render(<AlertsTab />);

    fireEvent.click(screen.getByText('COPY FOR OUTLOOK'));

    await waitFor(() => {
      expect(mockCapture.html2canvas).toHaveBeenCalled();
    });
    const clone = mockCapture.html2canvas.mock.calls.at(-1)?.[0] as HTMLElement;

    expect(clone.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect((clone.querySelector('.alerts-email-header') as HTMLElement).style.backgroundColor).toBe(
      'rgb(255, 255, 255)',
    );
    expect((clone.querySelector('.alerts-email-body') as HTMLElement).style.backgroundColor).toBe(
      'rgb(255, 255, 255)',
    );
    const iconWrapper = clone.querySelector('.alerts-email-icon-wrapper') as HTMLElement;
    const iconWrapperFill = iconWrapper.querySelector(
      '.alerts-email-icon-wrapper-fill',
    ) as HTMLElement;
    const icon = clone.querySelector('.alerts-email-icon') as HTMLElement;
    const iconFill = icon.querySelector('.alerts-email-icon-fill') as HTMLElement;
    const iconSvg = icon.querySelector('svg') as SVGElement;
    expect(iconWrapper.style.background).toBe('');
    expect(iconWrapper.style.backgroundColor).toBe('');
    expect(iconWrapperFill.style.top).toBe('26px');
    expect(iconWrapperFill.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(iconFill.style.inset).toBe('0px');
    expect(iconFill.style.borderRadius).toBe('50%');
    expect(iconFill.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(icon.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(icon.style.position).toBe('relative');
    expect(icon.style.zIndex).toBe('1');
    expect(iconSvg.style.position).toBe('relative');
    expect(iconSvg.style.zIndex).toBe('1');
    expect((clone.querySelector('.alerts-email-meta') as HTMLElement).style.backgroundColor).toBe(
      'rgb(250, 250, 250)',
    );
    expect((clone.querySelector('.alerts-email-footer') as HTMLElement).style.backgroundColor).toBe(
      'rgb(250, 250, 250)',
    );
  });

  it('opens the reminder time picker without copying from the alarm button', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-sender'));

    fireEvent.click(screen.getByText('SCHEDULE ALERT ALARM'));

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-draft-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('reminder-draft-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('reminder-draft-body')).toHaveTextContent('<p>body</p>');
    expect(screen.getByTestId('reminder-draft-sender')).toHaveTextContent('Security');
    expect(globalThis.api?.writeClipboardImage).not.toHaveBeenCalled();
    expect(mockCapture.html2canvas).not.toHaveBeenCalled();
  });

  it('clicking HISTORY button calls open on the modal state', () => {
    render(<AlertsTab />);
    const historyBtn = screen.getByText('HISTORY');
    fireEvent.click(historyBtn);
    expect(historyBtn).toBeInTheDocument();
  });

  it('opens reminder modal with current draft context', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-sender'));

    fireEvent.click(screen.getByText('ALARMS'));
    fireEvent.click(screen.getByTestId('manager-schedule'));

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-draft-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('reminder-draft-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('reminder-draft-body')).toHaveTextContent('<p>body</p>');
    expect(screen.getByTestId('reminder-draft-sender')).toHaveTextContent('Security');
  });

  it('loads an attached reminder alert into the composer', async () => {
    render(
      <AlertsTab
        loadedReminderAlert={{
          reminderId: 'rem-1',
          title: 'Stored reminder',
          severity: 'ISSUE',
          subject: 'Stored outage alert',
          bodyHtml: '<p>Stored body</p>',
          sender: 'Ops',
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
    });
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Stored outage alert');
    expect(screen.getByTestId('card-body')).toHaveTextContent('<p>Stored body</p>');
    expect(screen.getByTestId('card-sender')).toHaveTextContent('Ops');
    expect(mockShowToast).toHaveBeenCalledWith('Alert loaded from alarm', 'success');

    fireEvent.click(screen.getByText('SCHEDULE ALERT ALARM'));

    expect(screen.getByTestId('reminder-draft-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('reminder-draft-subject')).toHaveTextContent('Stored outage alert');
    expect(screen.getByTestId('reminder-draft-body')).toHaveTextContent('<p>Stored body</p>');
    expect(screen.getByTestId('reminder-draft-sender')).toHaveTextContent('Ops');
  });

  it('schedules reminders through the reminder hook', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('ALARMS'));
    fireEvent.click(screen.getByTestId('manager-schedule'));
    fireEvent.click(screen.getByTestId('reminder-schedule'));

    await waitFor(() => {
      expect(mockScheduleReminder).toHaveBeenCalledWith({ title: 'Scheduled reminder' });
    });
  });

  it('shows the next upcoming reminder compactly', () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'Send maintenance alert', dueAt: '2026-05-28T20:00:00.000Z' },
    ];

    render(<AlertsTab />);

    expect(screen.getByText('Next alarm')).toBeInTheDocument();
    expect(screen.getByText('Send maintenance alert')).toBeInTheDocument();
  });

  it('shows a count when more pending reminders exist and opens the manager from the strip', () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'First reminder', dueAt: '2026-05-28T20:00:00.000Z' },
      { id: 'rem-2', title: 'Second reminder', dueAt: '2026-05-28T21:00:00.000Z' },
      { id: 'rem-3', title: 'Third reminder', dueAt: '2026-05-28T22:00:00.000Z' },
    ];

    render(<AlertsTab />);

    expect(screen.getByText('+2 more')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming alert alarms' }));
    expect(screen.getByTestId('reminder-manager-modal')).toBeInTheDocument();
    expect(screen.getByTestId('manager-count')).toHaveTextContent('3');
  });

  it('opens the reminder manager from the header action', () => {
    render(<AlertsTab />);

    fireEvent.click(screen.getByText('ALARMS'));

    expect(screen.getByTestId('reminder-manager-modal')).toBeInTheDocument();
  });

  it('opens edit mode from the reminder manager and routes manager actions', async () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'Editable reminder', dueAt: '2026-05-28T20:00:00.000Z' },
    ];

    render(<AlertsTab />);
    fireEvent.click(screen.getByText('ALARMS'));
    fireEvent.click(screen.getByTestId('manager-edit'));

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-modal-mode')).toHaveTextContent('edit');
    expect(screen.getByTestId('reminder-edit-title')).toHaveTextContent('Editable reminder');

    fireEvent.click(screen.getByText('ALARMS'));
    fireEvent.click(screen.getByTestId('manager-done'));
    fireEvent.click(screen.getByTestId('manager-dismiss'));

    expect(mockMarkDone).toHaveBeenCalledWith('rem-1');
    expect(mockDismissReminder).toHaveBeenCalledWith('rem-1');
  });

  it('renders with null logo by default on the card', () => {
    render(<AlertsTab />);
    // AlertCard mock doesn't show logos, but we verify no crash
    expect(screen.getByTestId('alert-card')).toBeInTheDocument();
  });

  // --- Severity & form field dispatch tests ---

  it('changes severity via AlertForm callback', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
  });

  it('changes severity to RESOLVED', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-resolved'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('RESOLVED');
  });

  it('updates subject via form callback and reflects in card', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Test Subject');
  });

  it('updates sender and displays it on the card', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-sender'));
    expect(screen.getByTestId('card-sender')).toHaveTextContent('Security');
  });

  it('updates recipient and displays it on the card', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-recipient'));
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('Managers');
  });

  it('does not expose retired alert font size controls or props', () => {
    render(<AlertsTab />);

    expect(screen.queryByTestId('set-alert-font-large')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-retired-font-size-props')).toHaveTextContent('false');
    expect(screen.getByTestId('card-retired-font-size-prop')).toHaveTextContent('false');
  });

  it('shows UPDATE prefix in subject when updateNumber > 0', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-update-number'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('UPDATE #2');
  });

  it('shows UPDATE prefix combined with custom subject', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-update-number'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('UPDATE #2 — Test Subject');
  });

  it('does not expose retired compact or enhance controls to the alert form', () => {
    render(<AlertsTab />);
    expect(screen.queryByTestId('toggle-compact')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toggle-enhanced')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-retired-transform-props')).toHaveTextContent('false');
  });

  // --- History modal interactions ---

  it('opens history modal when HISTORY button is clicked', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('HISTORY'));
    expect(screen.getByTestId('history-modal')).toBeInTheDocument();
  });

  it('loads from history and updates form state', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByTestId('history-load'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('MAINTENANCE');
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Loaded Subject');
    expect(screen.getByTestId('card-sender')).toHaveTextContent('Ops');
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('Staff');
  });

  it('calls deleteHistory when delete is triggered from history modal', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByTestId('history-delete'));
    expect(mockDeleteHistory).toHaveBeenCalledWith('del-1');
  });

  it('calls clearHistory when clear is triggered from history modal', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('HISTORY'));
    fireEvent.click(screen.getByTestId('history-clear'));
    expect(mockClearHistory).toHaveBeenCalled();
  });

  // --- Pin template modal ---

  it('opens pin template modal and shows template name input', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    expect(screen.getByTestId('modal-Pin Template')).toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toBeInTheDocument();
  });

  it('pin template modal defaults to Untitled Template when subject is empty', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    expect(screen.getByLabelText('Template name')).toHaveValue('Untitled Template');
  });

  it('pin template modal uses subject as default name', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    expect(screen.getByLabelText('Template name')).toHaveValue('Test Subject');
  });

  it('can change pin template name and confirm', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    const input = screen.getByLabelText('Template name');
    fireEvent.change(input, { target: { value: 'My Custom Template' } });
    fireEvent.click(screen.getByText('PIN'));
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalledWith(
        expect.objectContaining({ pinned: true, label: 'My Custom Template' }),
      );
    });
  });

  it('pin template confirm with empty label sends undefined label', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    const input = screen.getByLabelText('Template name');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByText('PIN'));
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalledWith(
        expect.objectContaining({ pinned: true, label: undefined }),
      );
    });
  });

  it('pin template can be confirmed with Enter key', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    const input = screen.getByLabelText('Template name');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }));
    });
  });

  it('pin template CANCEL closes the modal', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    expect(screen.getByTestId('modal-Pin Template')).toBeInTheDocument();
    fireEvent.click(screen.getByText('CANCEL'));
    expect(screen.queryByTestId('modal-Pin Template')).not.toBeInTheDocument();
  });

  it('pin template confirm shows toast on success', async () => {
    mockAddHistory.mockResolvedValueOnce({ id: 'pin-1' });
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    fireEvent.click(screen.getByText('PIN'));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Pinned as template', 'success');
    });
  });

  it('pin template confirm shows error toast on failure', async () => {
    mockAddHistory.mockRejectedValueOnce(new Error('fail'));
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    fireEvent.click(screen.getByText('PIN'));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Failed to pin template', 'error');
    });
  });

  it('pin template confirm with null entry does not show success toast', async () => {
    mockAddHistory.mockResolvedValueOnce(null);
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    fireEvent.click(screen.getByText('PIN'));
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalled();
    });
    expect(mockShowToast).not.toHaveBeenCalledWith('Pinned as template', 'success');
  });

  // --- Reset button ---

  it('reset button clears form state back to defaults', () => {
    render(<AlertsTab />);
    // Change state
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-sender'));
    // Reset
    fireEvent.click(screen.getByText('RESET'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('INFO');
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Alert Subject');
    expect(screen.getByTestId('card-sender')).toHaveTextContent('IT');
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('All Employees');
  });

  // --- Non-enter keydown on pin template input ---

  it('non-Enter keydown on pin template input does not confirm', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByText('PIN TEMPLATE'));
    const input = screen.getByLabelText('Template name');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Modal should still be open, addHistory should not be called
    expect(screen.getByTestId('modal-Pin Template')).toBeInTheDocument();
    expect(mockAddHistory).not.toHaveBeenCalled();
  });
});
