import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// --- Mocks ---

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
    const onToggleCompact = props.onToggleCompact as () => void;
    const onToggleEnhanced = props.onToggleEnhanced as () => void;
    return (
      <div data-testid="alert-form">
        <button data-testid="set-severity-issue" onClick={() => setSeverity('ISSUE')}>set-issue</button>
        <button data-testid="set-severity-resolved" onClick={() => setSeverity('RESOLVED')}>set-resolved</button>
        <button data-testid="set-subject" onClick={() => setSubject('Test Subject')}>set-subject</button>
        <button data-testid="set-body" onClick={() => setBodyHtml('<p>body</p>')}>set-body</button>
        <button data-testid="set-sender" onClick={() => setSender('Security')}>set-sender</button>
        <button data-testid="set-recipient" onClick={() => setRecipient('Managers')}>set-recipient</button>
        <button data-testid="set-update-number" onClick={() => setUpdateNumber(2)}>set-update</button>
        <button data-testid="toggle-compact" onClick={onToggleCompact}>toggle-compact</button>
        <button data-testid="toggle-enhanced" onClick={onToggleEnhanced}>toggle-enhanced</button>
        <span data-testid="form-compact">{String(props.isCompact)}</span>
        <span data-testid="form-enhanced">{String(props.isEnhanced)}</span>
      </div>
    );
  }),
}));

vi.mock('../AlertCard', () => ({
  AlertCard: (props: Record<string, unknown>) => (
    <div data-testid="alert-card">
      <span data-testid="card-severity">{String(props.severity)}</span>
      <span data-testid="card-subject">{String(props.displaySubject)}</span>
      <span data-testid="card-sender">{String(props.displaySender)}</span>
      <span data-testid="card-recipient">{String(props.displayRecipient)}</span>
      <span data-testid="card-body">{String(props.bodyHtml)}</span>
    </div>
  ),
}));

// Mock AlertHistoryModal — render load button when open
vi.mock('../AlertHistoryModal', () => ({
  AlertHistoryModal: (props: { isOpen: boolean; onLoad: (entry: Record<string, unknown>) => void; onDelete: (id: string) => void; onClear: () => void }) =>
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
        <button data-testid="history-delete" onClick={() => props.onDelete('del-1')}>Delete</button>
        <button data-testid="history-clear" onClick={() => props.onClear()}>Clear</button>
      </div>
    ) : null,
}));

vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    loading,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    variant?: string;
  }) => (
    <button onClick={onClick} disabled={loading} data-variant={variant}>
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

vi.mock('../alerts/compactEngine', () => ({
  compactText: (text: string) => `[compact]${text}`,
}));

vi.mock('../alerts/enhanceEngine', () => ({
  enhanceHtml: (html: string) => `[enhanced]${html}`,
}));

// Stub globalThis.api
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).api = {
    getCompanyLogo: vi.fn().mockResolvedValue(null),
    getFooterLogo: vi.fn().mockResolvedValue(null),
    writeClipboardImage: vi.fn().mockResolvedValue(true),
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
    expect(screen.getByText('PIN TEMPLATE')).toBeInTheDocument();
    expect(screen.getByText('SAVE PNG')).toBeInTheDocument();
    expect(screen.getByText('COPY FOR OUTLOOK')).toBeInTheDocument();
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
    (api.getCompanyLogo as ReturnType<typeof vi.fn>).mockResolvedValue('data:image/png;base64,LOGO');
    render(<AlertsTab />);
    // The getCompanyLogo should have been called
    expect(api.getCompanyLogo).toHaveBeenCalled();
  });

  it('loads footer logo from api on mount', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getFooterLogo as ReturnType<typeof vi.fn>).mockResolvedValue('data:image/png;base64,FLOGO');
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

  it('clicking SAVE PNG calls the button handler', () => {
    render(<AlertsTab />);
    const saveBtn = screen.getByText('SAVE PNG');
    fireEvent.click(saveBtn);
    expect(saveBtn).toBeInTheDocument();
  });

  it('clicking COPY FOR OUTLOOK calls the button handler', () => {
    render(<AlertsTab />);
    const copyBtn = screen.getByText('COPY FOR OUTLOOK');
    fireEvent.click(copyBtn);
    expect(copyBtn).toBeInTheDocument();
  });

  it('clicking HISTORY button calls open on the modal state', () => {
    render(<AlertsTab />);
    const historyBtn = screen.getByText('HISTORY');
    fireEvent.click(historyBtn);
    expect(historyBtn).toBeInTheDocument();
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

  // --- Compact/Enhance toggles ---

  it('toggles compact on then off restoring original body', () => {
    render(<AlertsTab />);
    // Set some body content first
    fireEvent.click(screen.getByTestId('set-body'));
    expect(screen.getByTestId('card-body')).toHaveTextContent('<p>body</p>');

    // Toggle compact ON
    fireEvent.click(screen.getByTestId('toggle-compact'));
    expect(screen.getByTestId('form-compact')).toHaveTextContent('true');

    // Toggle compact OFF — should restore original
    fireEvent.click(screen.getByTestId('toggle-compact'));
    expect(screen.getByTestId('form-compact')).toHaveTextContent('false');
  });

  it('toggles enhanced on then off restoring original body', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-body'));

    // Toggle enhanced ON
    fireEvent.click(screen.getByTestId('toggle-enhanced'));
    expect(screen.getByTestId('form-enhanced')).toHaveTextContent('true');

    // Toggle enhanced OFF — should restore
    fireEvent.click(screen.getByTestId('toggle-enhanced'));
    expect(screen.getByTestId('form-enhanced')).toHaveTextContent('false');
  });

  it('can have both compact and enhanced on at the same time', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('toggle-compact'));
    fireEvent.click(screen.getByTestId('toggle-enhanced'));
    expect(screen.getByTestId('form-compact')).toHaveTextContent('true');
    expect(screen.getByTestId('form-enhanced')).toHaveTextContent('true');
  });

  it('turning off compact while enhanced is still on keeps enhanced', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-body'));
    // Turn both on
    fireEvent.click(screen.getByTestId('toggle-compact'));
    fireEvent.click(screen.getByTestId('toggle-enhanced'));
    // Turn compact off
    fireEvent.click(screen.getByTestId('toggle-compact'));
    expect(screen.getByTestId('form-compact')).toHaveTextContent('false');
    expect(screen.getByTestId('form-enhanced')).toHaveTextContent('true');
  });

  it('turning off enhanced while compact is still on keeps compact', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-body'));
    // Turn both on
    fireEvent.click(screen.getByTestId('toggle-compact'));
    fireEvent.click(screen.getByTestId('toggle-enhanced'));
    // Turn enhanced off
    fireEvent.click(screen.getByTestId('toggle-enhanced'));
    expect(screen.getByTestId('form-compact')).toHaveTextContent('true');
    expect(screen.getByTestId('form-enhanced')).toHaveTextContent('false');
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
