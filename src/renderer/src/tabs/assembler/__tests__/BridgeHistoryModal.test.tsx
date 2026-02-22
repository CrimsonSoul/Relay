import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeHistoryModal } from '../BridgeHistoryModal';
import type { BridgeHistoryEntry } from '@shared/ipc';

// Mock Modal to avoid portal
vi.mock('../../../components/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
}));

// Mock ContextMenu
vi.mock('../../../components/ContextMenu', () => ({
  ContextMenu: ({ items }: { items: Array<{ label: string; onClick: () => void }> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'context-menu' },
      items.map((item) =>
        React.createElement(
          'button',
          { key: item.label, onClick: item.onClick, 'data-testid': `menu-${item.label}` },
          item.label,
        ),
      ),
    ),
}));

// Mock TactileButton
vi.mock('../../../components/TactileButton', () => ({
  TactileButton: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', { onClick, ...props }, children),
}));

describe('BridgeHistoryModal', () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const lastWeek = new Date(now.getTime() - 7 * 86400000);

  const mockHistory: BridgeHistoryEntry[] = [
    {
      id: 'h1',
      timestamp: now.getTime(),
      note: 'Today bridge',
      groups: ['Network', 'Database'],
      contacts: ['a@test.com', 'b@test.com'],
      recipientCount: 2,
    },
    {
      id: 'h2',
      timestamp: yesterday.getTime(),
      note: '',
      groups: [],
      contacts: ['c@test.com'],
      recipientCount: 1,
    },
    {
      id: 'h3',
      timestamp: lastWeek.getTime(),
      note: 'Old bridge',
      groups: ['Security'],
      contacts: ['d@test.com', 'e@test.com', 'f@test.com'],
      recipientCount: 3,
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    history: mockHistory,
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    onSaveAsGroup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the modal with title', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    expect(screen.getByText('Bridge History')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<BridgeHistoryModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Bridge History')).not.toBeInTheDocument();
  });

  it('shows empty state when history is empty', () => {
    render(<BridgeHistoryModal {...defaultProps} history={[]} />);
    expect(
      screen.getByText('No bridge history yet. History is saved when you copy a bridge.'),
    ).toBeInTheDocument();
    // Clear All button should not appear
    expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
  });

  it('displays recipient count for each entry', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    expect(screen.getByText('2 recipients')).toBeInTheDocument();
    expect(screen.getByText('1 recipient')).toBeInTheDocument();
    expect(screen.getByText('3 recipients')).toBeInTheDocument();
  });

  it('displays notes when present', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    expect(screen.getByText('Today bridge')).toBeInTheDocument();
    expect(screen.getByText('Old bridge')).toBeInTheDocument();
  });

  it('displays group pills', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });

  it('formats today timestamps as "Today at ..."', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    const todayText = screen.getAllByText(/^Today at/);
    expect(todayText).toHaveLength(1);
  });

  it('formats yesterday timestamps as "Yesterday at ..."', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    const yesterdayText = screen.getAllByText(/^Yesterday at/);
    expect(yesterdayText.length).toBeGreaterThanOrEqual(1);
  });

  it('loads entry on click and closes modal', () => {
    const onLoad = vi.fn();
    const onClose = vi.fn();
    render(<BridgeHistoryModal {...defaultProps} onLoad={onLoad} onClose={onClose} />);

    // Click the first entry (Today bridge note is visible)
    fireEvent.click(screen.getByText('Today bridge'));

    expect(onLoad).toHaveBeenCalledWith(mockHistory[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows context menu on right-click', () => {
    render(<BridgeHistoryModal {...defaultProps} />);

    // Right-click on an entry
    fireEvent.contextMenu(screen.getByText('Today bridge'));

    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    expect(screen.getByTestId('menu-Load Bridge')).toBeInTheDocument();
    expect(screen.getByTestId('menu-Save as Group')).toBeInTheDocument();
    expect(screen.getByTestId('menu-Delete')).toBeInTheDocument();
  });

  it('context menu Save as Group calls onSaveAsGroup', () => {
    const onSaveAsGroup = vi.fn();
    render(<BridgeHistoryModal {...defaultProps} onSaveAsGroup={onSaveAsGroup} />);

    fireEvent.contextMenu(screen.getByText('Today bridge'));
    fireEvent.click(screen.getByTestId('menu-Save as Group'));

    expect(onSaveAsGroup).toHaveBeenCalledWith(mockHistory[0]);
  });

  it('context menu Delete calls onDelete with entry id', () => {
    const onDelete = vi.fn();
    render(<BridgeHistoryModal {...defaultProps} onDelete={onDelete} />);

    fireEvent.contextMenu(screen.getByText('Today bridge'));
    fireEvent.click(screen.getByTestId('menu-Delete'));

    expect(onDelete).toHaveBeenCalledWith('h1');
  });

  it('calls onClose when Close button is clicked', () => {
    const onClose = vi.fn();
    render(<BridgeHistoryModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Clear All button when history has entries', () => {
    render(<BridgeHistoryModal {...defaultProps} />);
    expect(screen.getByText('Clear All')).toBeInTheDocument();
  });

  it('calls onClear after globalThis.confirm for Clear All', () => {
    const onClear = vi.fn();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);

    render(<BridgeHistoryModal {...defaultProps} onClear={onClear} />);

    fireEvent.click(screen.getByText('Clear All'));
    expect(onClear).toHaveBeenCalled();
  });

  it('does not call onClear when confirm is cancelled', () => {
    const onClear = vi.fn();
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    render(<BridgeHistoryModal {...defaultProps} onClear={onClear} />);

    fireEvent.click(screen.getByText('Clear All'));
    expect(onClear).not.toHaveBeenCalled();
  });
});
