import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertHistoryModal } from '../AlertHistoryModal';
import type { AlertHistoryEntry } from '@shared/ipc';

// --- Mocks ---

vi.mock('../../components/HistoryModal', () => ({
  HistoryModal: ({
    isOpen,
    title,
    emptyText,
    history,
    renderEntry,
    onClose,
    extraContent,
    getContextMenuItems,
  }: {
    isOpen: boolean;
    title: string;
    emptyText: string;
    history: AlertHistoryEntry[];
    renderEntry: (
      entry: AlertHistoryEntry,
      helpers: { formatDate: (ts: number) => string },
    ) => React.ReactNode;
    onClose: () => void;
    extraContent?: React.ReactNode;
    getContextMenuItems?: (
      entry: AlertHistoryEntry,
      helpers: { closeMenu: () => void; closeModal: () => void },
    ) => Array<{ label: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode }>;
    [key: string]: unknown;
  }) =>
    isOpen ? (
      <div data-testid="history-modal">
        <h2>{title}</h2>
        {history.length === 0 ? (
          <p>{emptyText}</p>
        ) : (
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                {renderEntry(entry, { formatDate: (ts: number) => new Date(ts).toISOString() })}
                {getContextMenuItems && (
                  <div data-testid={`context-menu-${entry.id}`}>
                    {getContextMenuItems(entry, { closeMenu: () => {}, closeModal: onClose }).map(
                      (item) => (
                        <button
                          key={item.label}
                          data-testid={`ctx-${item.label}`}
                          onClick={item.onClick}
                        >
                          {item.label}
                        </button>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <button onClick={onClose}>close</button>
        {extraContent}
      </div>
    ) : null,
}));

vi.mock('../../components/TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => <button onClick={onClick}>{children}</button>,
}));

const makeEntry = (overrides: Partial<AlertHistoryEntry> = {}): AlertHistoryEntry => ({
  id: 'entry-1',
  timestamp: Date.now() - 60000,
  severity: 'ISSUE',
  subject: 'Server Outage',
  bodyHtml: '<p>Details</p>',
  sender: 'IT',
  recipient: 'All Staff',
  ...overrides,
});

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  history: [makeEntry()],
  onLoad: vi.fn(),
  onDelete: vi.fn(),
  onClear: vi.fn(),
  onPin: vi.fn().mockResolvedValue(true),
  onUpdateLabel: vi.fn(),
};

describe('AlertHistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    expect(screen.getByTestId('history-modal')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AlertHistoryModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('history-modal')).not.toBeInTheDocument();
  });

  it('renders the title', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    expect(screen.getByText('Alert History')).toBeInTheDocument();
  });

  it('renders history entry with severity', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    expect(screen.getByText('ISSUE')).toBeInTheDocument();
  });

  it('renders history entry subject', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    expect(screen.getByText('Server Outage')).toBeInTheDocument();
  });

  it('renders sender info', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    expect(screen.getByText('From: IT')).toBeInTheDocument();
  });

  it('shows (no subject) when subject is empty', () => {
    render(
      <AlertHistoryModal {...defaultProps} history={[makeEntry({ id: 'e2', subject: '' })]} />,
    );
    expect(screen.getByText('(no subject)')).toBeInTheDocument();
  });

  it('shows empty text when history is empty', () => {
    render(<AlertHistoryModal {...defaultProps} history={[]} />);
    expect(screen.getByText(/No alert history yet/)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    fireEvent.click(screen.getByText('close'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('renders pinned icon for pinned entries', () => {
    render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: true })]} />);
    // The pin icon has a title attribute
    expect(screen.getByTitle('Pinned template')).toBeInTheDocument();
  });

  it('shows label instead of date for entries with a label', () => {
    render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ label: 'My Template' })]} />);
    expect(screen.getByText('My Template')).toBeInTheDocument();
  });

  it('does not show sender line when sender is empty', () => {
    render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ sender: '' })]} />);
    expect(screen.queryByText(/From:/)).not.toBeInTheDocument();
  });

  it('renders with multiple history entries', () => {
    render(
      <AlertHistoryModal
        {...defaultProps}
        history={[
          makeEntry({ id: 'e1', subject: 'First' }),
          makeEntry({ id: 'e2', subject: 'Second', severity: 'MAINTENANCE' }),
        ]}
      />,
    );
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('MAINTENANCE')).toBeInTheDocument();
  });

  it('renders severity dot with correct color for ISSUE', () => {
    const { container } = render(<AlertHistoryModal {...defaultProps} />);
    const sevEl = container.querySelector('.alert-history-entry-severity') as HTMLElement;
    expect(sevEl?.style.getPropertyValue('--severity-color')).toBe('#d32f2f');
  });

  it('renders severity dot with correct color for INFO', () => {
    const { container } = render(
      <AlertHistoryModal {...defaultProps} history={[makeEntry({ severity: 'INFO' })]} />,
    );
    const sevEl = container.querySelector('.alert-history-entry-severity') as HTMLElement;
    expect(sevEl?.style.getPropertyValue('--severity-color')).toBe('#1565c0');
  });

  it('renders severity dot with correct color for RESOLVED', () => {
    const { container } = render(
      <AlertHistoryModal {...defaultProps} history={[makeEntry({ severity: 'RESOLVED' })]} />,
    );
    const sevEl = container.querySelector('.alert-history-entry-severity') as HTMLElement;
    expect(sevEl?.style.getPropertyValue('--severity-color')).toBe('#2e7d32');
  });

  it('renders severity dot with correct color for MAINTENANCE', () => {
    const { container } = render(
      <AlertHistoryModal {...defaultProps} history={[makeEntry({ severity: 'MAINTENANCE' })]} />,
    );
    const sevEl = container.querySelector('.alert-history-entry-severity') as HTMLElement;
    expect(sevEl?.style.getPropertyValue('--severity-color')).toBe('#f9a825');
  });

  it('does not show extra content (label editor) by default', () => {
    render(<AlertHistoryModal {...defaultProps} />);
    expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
  });

  it('shows date when entry has no label', () => {
    const entry = makeEntry({ label: undefined });
    render(<AlertHistoryModal {...defaultProps} history={[entry]} />);
    // The formatDate returns ISO string, so some date content should be present
    expect(screen.queryByText('My Template')).not.toBeInTheDocument();
  });

  it('does not show pin icon when entry is not pinned', () => {
    render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
    expect(screen.queryByTitle('Pinned template')).not.toBeInTheDocument();
  });

  describe('context menu actions', () => {
    it('renders Load Alert context menu item', () => {
      render(<AlertHistoryModal {...defaultProps} />);
      expect(screen.getByTestId('ctx-Load Alert')).toBeInTheDocument();
    });

    it('calls onLoad when Load Alert is clicked', () => {
      render(<AlertHistoryModal {...defaultProps} />);
      fireEvent.click(screen.getByTestId('ctx-Load Alert'));
      expect(defaultProps.onLoad).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' }));
    });

    it('renders Pin as Template for unpinned entries', () => {
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      expect(screen.getByTestId('ctx-Pin as Template')).toBeInTheDocument();
    });

    it('renders Unpin for pinned entries', () => {
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: true })]} />);
      expect(screen.getByTestId('ctx-Unpin')).toBeInTheDocument();
    });

    it('calls onPin with true when Pin as Template is clicked', () => {
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));
      expect(defaultProps.onPin).toHaveBeenCalledWith('entry-1', true);
    });

    it('calls onPin with false when Unpin is clicked', () => {
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: true })]} />);
      fireEvent.click(screen.getByTestId('ctx-Unpin'));
      expect(defaultProps.onPin).toHaveBeenCalledWith('entry-1', false);
    });

    it('shows Rename option for pinned entries', () => {
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: true })]} />);
      expect(screen.getByTestId('ctx-Rename')).toBeInTheDocument();
    });

    it('does not show Rename option for unpinned entries', () => {
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      expect(screen.queryByTestId('ctx-Rename')).not.toBeInTheDocument();
    });

    it('renders Delete context menu item', () => {
      render(<AlertHistoryModal {...defaultProps} />);
      expect(screen.getByTestId('ctx-Delete')).toBeInTheDocument();
    });

    it('calls onDelete when Delete is clicked', () => {
      render(<AlertHistoryModal {...defaultProps} />);
      fireEvent.click(screen.getByTestId('ctx-Delete'));
      expect(defaultProps.onDelete).toHaveBeenCalledWith('entry-1');
    });

    it('opens label editor after successful pin', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      // Wait for the pin promise to resolve and label editor to appear
      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });
    });

    it('does not open label editor when pin returns false', async () => {
      defaultProps.onPin.mockResolvedValue(false);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      // Give the promise time to resolve
      await new Promise((r) => setTimeout(r, 50));

      expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
    });

    it('opens label editor on Rename click for pinned entry', async () => {
      render(
        <AlertHistoryModal
          {...defaultProps}
          history={[makeEntry({ pinned: true, label: 'Old Name' })]}
        />,
      );
      fireEvent.click(screen.getByTestId('ctx-Rename'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });
      // The input should be pre-filled with the existing label
      const input = screen.getByPlaceholderText('e.g. Network Outage Template');
      expect((input as HTMLInputElement).value).toBe('Old Name');
    });
  });

  describe('label editor', () => {
    it('commits label on Save button click', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('e.g. Network Outage Template');
      fireEvent.change(input, { target: { value: 'My Template' } });
      fireEvent.click(screen.getByText('Save'));

      expect(defaultProps.onUpdateLabel).toHaveBeenCalledWith('entry-1', 'My Template');
      // Editor should close after save
      expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
    });

    it('commits label on Enter key in input', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('e.g. Network Outage Template');
      fireEvent.change(input, { target: { value: 'Enter Template' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(defaultProps.onUpdateLabel).toHaveBeenCalledWith('entry-1', 'Enter Template');
    });

    it('cancels label editing on Escape key in input', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('e.g. Network Outage Template');
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
      expect(defaultProps.onUpdateLabel).not.toHaveBeenCalled();
    });

    it('cancels label editing on Cancel button click', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
      expect(defaultProps.onUpdateLabel).not.toHaveBeenCalled();
    });

    it('commits label when clicking overlay background', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('e.g. Network Outage Template');
      fireEvent.change(input, { target: { value: 'Overlay Save' } });

      // Click the overlay div itself
      const overlay = document.querySelector('.alert-history-label-overlay')!;
      fireEvent.click(overlay, { target: overlay, currentTarget: overlay });

      expect(defaultProps.onUpdateLabel).toHaveBeenCalledWith('entry-1', 'Overlay Save');
    });

    it('dismisses label editor on Escape key on overlay', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      const overlay = document.querySelector('.alert-history-label-overlay')!;
      fireEvent.keyDown(overlay, { key: 'Escape' });

      expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
    });

    it('trims whitespace from label on commit', async () => {
      defaultProps.onPin.mockResolvedValue(true);
      render(<AlertHistoryModal {...defaultProps} history={[makeEntry({ pinned: false })]} />);
      fireEvent.click(screen.getByTestId('ctx-Pin as Template'));

      await waitFor(() => {
        expect(screen.getByLabelText('Edit template name')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('e.g. Network Outage Template');
      fireEvent.change(input, { target: { value: '  Trimmed  ' } });
      fireEvent.click(screen.getByText('Save'));

      expect(defaultProps.onUpdateLabel).toHaveBeenCalledWith('entry-1', 'Trimmed');
    });
  });

  it('resets label editor state when modal closes', () => {
    defaultProps.onPin.mockResolvedValue(true);
    const { rerender } = render(
      <AlertHistoryModal
        {...defaultProps}
        history={[makeEntry({ pinned: true, label: 'Test' })]}
      />,
    );

    // Open label editor via Rename
    fireEvent.click(screen.getByTestId('ctx-Rename'));

    // Now close the modal
    rerender(
      <AlertHistoryModal
        {...defaultProps}
        isOpen={false}
        history={[makeEntry({ pinned: true, label: 'Test' })]}
      />,
    );

    // Reopen - editor should not be showing
    rerender(
      <AlertHistoryModal
        {...defaultProps}
        isOpen={true}
        history={[makeEntry({ pinned: true, label: 'Test' })]}
      />,
    );

    expect(screen.queryByLabelText('Edit template name')).not.toBeInTheDocument();
  });
});
