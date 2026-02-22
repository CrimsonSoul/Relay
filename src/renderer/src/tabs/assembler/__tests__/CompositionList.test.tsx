import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CompositionList } from '../CompositionList';

// Mock AutoSizer to render with fixed dimensions
vi.mock('react-virtualized-auto-sizer', () => ({
  AutoSizer: ({
    renderProp,
  }: {
    renderProp: (size: { height: number; width: number }) => React.ReactNode;
  }) => renderProp({ height: 400, width: 600 }),
}));

// Mock react-window List
vi.mock('react-window', () => ({
  List: ({
    rowCount,
    rowComponent: RowComponent,
    rowProps,
  }: {
    rowCount: number;
    rowComponent: React.ComponentType<{
      index: number;
      style: React.CSSProperties;
      [key: string]: unknown;
    }>;
    rowProps: Record<string, unknown>;
  }) => (
    <div data-testid="virtual-list">
      {Array.from({ length: rowCount }, (_, i) => (
        <RowComponent key={i} index={i} style={{}} {...rowProps} />
      ))}
    </div>
  ),
}));

// Mock VirtualRow
vi.mock('../VirtualRow', () => ({
  VirtualRow: ({ index }: { index: number }) => <div data-testid={`row-${index}`}>Row {index}</div>,
}));

const mockItemData = {
  log: [],
  contacts: [],
  onRemove: vi.fn(),
  onEdit: vi.fn(),
  groups: [],
};

describe('CompositionList', () => {
  it('shows empty state when log is empty', () => {
    render(<CompositionList log={[]} itemData={mockItemData as never} onScroll={vi.fn()} />);
    expect(screen.getByText('No recipients selected')).toBeInTheDocument();
  });

  it('renders virtual list when log has items', () => {
    const log = [
      { email: 'a@b.com', source: 'manual' },
      { email: 'c@d.com', source: 'group' },
    ];
    render(<CompositionList log={log} itemData={mockItemData as never} onScroll={vi.fn()} />);
    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
  });

  it('does not show empty state when log has items', () => {
    const log = [{ email: 'a@b.com', source: 'manual' }];
    render(<CompositionList log={log} itemData={mockItemData as never} onScroll={vi.fn()} />);
    expect(screen.queryByText('No recipients selected')).not.toBeInTheDocument();
  });
});
