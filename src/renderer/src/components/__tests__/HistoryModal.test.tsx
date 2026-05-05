import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HistoryModal, formatHistoryDate, type BaseHistoryEntry } from '../HistoryModal';

// Mock Modal to render children directly
vi.mock('../Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        {title && <h2>{title}</h2>}
        {children}
      </div>
    ) : null,
}));

// Mock ContextMenu
vi.mock('../ContextMenu', () => ({
  ContextMenu: ({
    items,
    onClose,
  }: {
    x: number;
    y: number;
    onClose: () => void;
    items: { label: string; onClick: () => void }[];
  }) => (
    <div data-testid="context-menu">
      {items.map((item) => (
        <button key={item.label} onClick={item.onClick}>
          {item.label}
        </button>
      ))}
      <button onClick={onClose}>close-menu</button>
    </div>
  ),
}));

// Mock TactileButton
vi.mock('../TactileButton', () => ({
  TactileButton: ({
    children,
    onClick,
    variant,
    size,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

type TestEntry = BaseHistoryEntry & { label: string };

const makeEntry = (overrides: Partial<TestEntry> = {}): TestEntry => ({
  id: 'entry-1',
  timestamp: Date.now() - 60000,
  label: 'Test Entry',
  ...overrides,
});

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  history: [makeEntry()],
  title: 'Test History',
  classPrefix: 'test-history',
  emptyText: 'No entries yet',
  clearConfirmText: 'Clear all entries?',
  onLoad: vi.fn(),
  onDelete: vi.fn(),
  onClear: vi.fn(),
  renderEntry: (entry: TestEntry, { formatDate }: { formatDate: (ts: number) => string }) => (
    <span>
      {entry.label} - {formatDate(entry.timestamp)}
    </span>
  ),
  getContextMenuItems: (
    entry: TestEntry,
    { closeMenu }: { closeMenu: () => void; closeModal: () => void },
  ) => [
    { label: 'Delete', onClick: closeMenu },
    { label: 'Load', onClick: closeMenu },
  ],
};

describe('HistoryModal', () => {
  it('returns null when not open', () => {
    const { container } = render(<HistoryModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders entries when open', () => {
    render(<HistoryModal {...defaultProps} />);
    expect(screen.getByText(/Test Entry/)).toBeInTheDocument();
  });

  it('shows empty state when history is empty', () => {
    render(<HistoryModal {...defaultProps} history={[]} />);
    expect(screen.getByText('No entries yet')).toBeInTheDocument();
    expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
  });

  it('shows Clear All button when history has items', () => {
    render(<HistoryModal {...defaultProps} />);
    expect(screen.getByText('Clear All')).toBeInTheDocument();
  });

  it('uses app button variants for history actions', () => {
    render(<HistoryModal {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Clear All' })).toHaveAttribute(
      'data-variant',
      'ghost',
    );
    expect(screen.getByRole('button', { name: 'Clear All' })).toHaveAttribute('data-size', 'sm');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute(
      'data-variant',
      'secondary',
    );
  });

  it('opens an in-app warning prompt before clearing all history', () => {
    const onClear = vi.fn();
    render(<HistoryModal {...defaultProps} onClear={onClear} />);

    fireEvent.click(screen.getByText('Clear All'));

    expect(screen.getByText('Clear History?')).toBeInTheDocument();
    expect(screen.getByText('Clear all entries?')).toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('calls onClear when the in-app warning prompt is confirmed', () => {
    const onClear = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, 'confirm');
    render(<HistoryModal {...defaultProps} onClear={onClear} />);

    fireEvent.click(screen.getByText('Clear All'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear History' }));

    expect(onClear).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not call onClear when the in-app warning prompt is cancelled', () => {
    const onClear = vi.fn();
    render(<HistoryModal {...defaultProps} onClear={onClear} />);

    fireEvent.click(screen.getByText('Clear All'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClear).not.toHaveBeenCalled();
    expect(screen.queryByText('Clear History?')).not.toBeInTheDocument();
  });

  it('calls onLoad and onClose when entry is clicked', () => {
    const onLoad = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry();
    render(<HistoryModal {...defaultProps} history={[entry]} onLoad={onLoad} onClose={onClose} />);
    fireEvent.click(screen.getByText(/Test Entry/));
    expect(onLoad).toHaveBeenCalledWith(entry);
    expect(onClose).toHaveBeenCalled();
  });

  it('activates entry on Enter keydown', () => {
    const onLoad = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry();
    render(<HistoryModal {...defaultProps} history={[entry]} onLoad={onLoad} onClose={onClose} />);
    const btn = screen.getByText(/Test Entry/).closest('button')!;
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onLoad).toHaveBeenCalledWith(entry);
  });

  it('activates entry on Space keydown', () => {
    const onLoad = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry();
    render(<HistoryModal {...defaultProps} history={[entry]} onLoad={onLoad} onClose={onClose} />);
    const btn = screen.getByText(/Test Entry/).closest('button')!;
    fireEvent.keyDown(btn, { key: ' ' });
    expect(onLoad).toHaveBeenCalledWith(entry);
  });

  it('opens context menu on right-click', () => {
    render(<HistoryModal {...defaultProps} />);
    const btn = screen.getByText(/Test Entry/).closest('button')!;
    fireEvent.contextMenu(btn);
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  it('renders pinned sections when enablePinnedSections is true', () => {
    const pinnedEntry = makeEntry({ id: 'pinned-1', label: 'Pinned Item', pinned: true });
    const recentEntry = makeEntry({ id: 'recent-1', label: 'Recent Item', pinned: false });

    render(
      <HistoryModal
        {...defaultProps}
        history={[pinnedEntry, recentEntry]}
        enablePinnedSections={true}
        pinnedSectionLabel="Pinned"
        recentSectionLabel="Recent"
      />,
    );

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText(/Pinned Item/)).toBeInTheDocument();
    expect(screen.getByText(/Recent Item/)).toBeInTheDocument();
  });

  it('wraps pinned and recent sections for custom section layouts', () => {
    const pinnedEntry = makeEntry({ id: 'pinned-1', label: 'Pinned Item', pinned: true });
    const recentEntry = makeEntry({ id: 'recent-1', label: 'Recent Item', pinned: false });
    const { container } = render(
      <HistoryModal
        {...defaultProps}
        history={[pinnedEntry, recentEntry]}
        enablePinnedSections={true}
        pinnedSectionLabel="Pinned"
        recentSectionLabel="Recent"
      />,
    );

    expect(container.querySelector('.test-history-section-pinned')).toBeInTheDocument();
    expect(container.querySelector('.test-history-section-recent')).toBeInTheDocument();
    expect(container.querySelectorAll('.test-history-section-items')).toHaveLength(2);
  });

  it('renders optional toolbar content between header and list', () => {
    render(
      <HistoryModal {...defaultProps} toolbar={<div data-testid="history-toolbar">Find</div>} />,
    );
    expect(screen.getByTestId('history-toolbar')).toBeInTheDocument();
  });

  it('does not show recent label when no pinned items exist', () => {
    const recentEntry = makeEntry({ id: 'recent-1', label: 'Recent Item', pinned: false });

    render(
      <HistoryModal
        {...defaultProps}
        history={[recentEntry]}
        enablePinnedSections={true}
        pinnedSectionLabel="Pinned"
        recentSectionLabel="Recent"
      />,
    );

    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    expect(screen.getByText(/Recent Item/)).toBeInTheDocument();
  });

  it('shows only pinned section when no recent items exist', () => {
    const pinnedEntry = makeEntry({ id: 'pinned-1', label: 'Pinned Item', pinned: true });

    render(
      <HistoryModal
        {...defaultProps}
        history={[pinnedEntry]}
        enablePinnedSections={true}
        pinnedSectionLabel="Pinned"
        recentSectionLabel="Recent"
      />,
    );

    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('renders extraContent when provided', () => {
    render(
      <HistoryModal
        {...defaultProps}
        extraContent={<div data-testid="extra">Extra content</div>}
      />,
    );
    expect(screen.getByTestId('extra')).toBeInTheDocument();
  });

  it('closes modal via Close button', () => {
    const onClose = vi.fn();
    render(<HistoryModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('formatHistoryDate', () => {
  it('returns "Today at ..." for today timestamps', () => {
    const now = Date.now();
    const result = formatHistoryDate(now);
    expect(result).toMatch(/^Today at /);
  });

  it('returns "Yesterday at ..." for yesterday timestamps', () => {
    const yesterday = Date.now() - 86400000;
    const result = formatHistoryDate(yesterday);
    expect(result).toMatch(/^Yesterday at /);
  });

  it('returns formatted date for older timestamps', () => {
    const oldDate = new Date('2024-01-15T10:30:00').getTime();
    const result = formatHistoryDate(oldDate);
    expect(result).toMatch(/Jan/);
  });
});
