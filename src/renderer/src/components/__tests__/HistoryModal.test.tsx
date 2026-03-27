import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HistoryModal, formatHistoryDate, type BaseHistoryEntry } from '../HistoryModal';

// Mock Modal to render children directly
vi.mock('../Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
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
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    className?: string;
  }) => <button onClick={onClick}>{children}</button>,
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

  it('calls onClear when Clear All is confirmed', () => {
    const onClear = vi.fn();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    render(<HistoryModal {...defaultProps} onClear={onClear} />);
    fireEvent.click(screen.getByText('Clear All'));
    expect(onClear).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not call onClear when Clear All is cancelled', () => {
    const onClear = vi.fn();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    render(<HistoryModal {...defaultProps} onClear={onClear} />);
    fireEvent.click(screen.getByText('Clear All'));
    expect(onClear).not.toHaveBeenCalled();
    vi.restoreAllMocks();
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
