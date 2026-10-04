import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CompositionList } from '../CompositionList';
import { SearchProvider } from '../../../contexts/SearchContext';

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
  VirtualRow: ({ index, log }: { index: number; log: { email: string }[] }) => (
    <button type="button" data-testid={`row-${index}`} data-record-key={log[index]?.email}>
      Row {index}
    </button>
  ),
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

  it('points an empty composition without groups at search, leaving History to the command bar', () => {
    const { container } = render(
      <CompositionList log={[]} itemData={mockItemData as never} onScroll={vi.fn()} />,
    );

    expect(
      screen.getByText(/to find contacts, or type or paste email addresses/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/history/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/select a group/i)).not.toBeInTheDocument();
    expect(container.querySelector('.empty-state__glyph')).toHaveAttribute('aria-hidden', 'true');
    // The header History command is the route; the empty state does not duplicate it.
    expect(screen.queryByRole('button', { name: /history/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add email/i)).not.toBeInTheDocument();
  });

  it('points an empty composition with groups at the group list first', () => {
    render(
      <CompositionList log={[]} itemData={mockItemData as never} onScroll={vi.fn()} hasGroups />,
    );

    expect(screen.getByText(/select a group on the left/i)).toBeInTheDocument();
  });

  it('names Search Relay once, on the CTA, and keeps the sentence to what is new', () => {
    const searchInputRef = { current: null };
    const { container } = render(
      <SearchProvider activeTab="Compose" searchInputRef={searchInputRef}>
        <CompositionList log={[]} itemData={mockItemData as never} onScroll={vi.fn()} />
      </SearchProvider>,
    );

    expect(screen.getByRole('button', { name: /^Search Relay/ })).toBeInTheDocument();
    expect(
      screen.getByText('You can also type or paste email addresses into search.'),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/history/i);
    expect(container.textContent?.match(/Search Relay/g)).toHaveLength(1);
  });

  it('uses a neutral glyph and offers current on-call people as quick adds', () => {
    const onAddSuggestion = vi.fn();
    const { container } = render(
      <CompositionList
        log={[]}
        itemData={mockItemData as never}
        onScroll={vi.fn()}
        onCallSuggestions={[
          {
            email: 'ada@example.com',
            name: 'Ada Lovelace',
            role: 'Primary',
            roleKind: 'primary',
            team: 'Database',
          },
        ]}
        onAddSuggestion={onAddSuggestion}
      />,
    );

    expect(container.querySelector('.empty-state__glyph')).not.toHaveTextContent('∅');
    expect(screen.getByRole('heading', { name: 'On call now' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Ada Lovelace, Primary, Database' }));
    expect(onAddSuggestion).toHaveBeenCalledWith('ada@example.com');
  });

  it('keeps remaining on-call people as a compact strip above a non-empty list', () => {
    const onAddSuggestion = vi.fn();
    const onAddAllSuggestions = vi.fn();
    const log = [{ email: 'hedy@example.com', source: 'manual' }];
    const { container } = render(
      <CompositionList
        log={log}
        itemData={{ ...mockItemData, log } as never}
        onScroll={vi.fn()}
        onCallSuggestions={[
          {
            email: 'claude@example.com',
            name: 'Claude Shannon',
            role: 'Standby',
            roleKind: 'backup',
            team: 'Network Ops',
          },
          {
            email: 'ada@example.com',
            name: 'Ada Lovelace',
            role: 'Member',
            roleKind: 'member',
            team: 'Network Ops',
          },
        ]}
        onAddSuggestion={onAddSuggestion}
        onAddAllSuggestions={onAddAllSuggestions}
      />,
    );

    expect(screen.getByTestId('virtual-list')).toBeInTheDocument();
    expect(container.querySelector('.composition-list-suggestions--strip')).not.toBeNull();
    const claude = screen.getByRole('button', { name: 'Add Claude Shannon, Standby, Network Ops' });
    // The full role word only; no BKP code beside it.
    expect(claude).toHaveTextContent('Standby · Network Ops');
    expect(claude).not.toHaveTextContent('BKP');
    fireEvent.click(claude);
    expect(onAddSuggestion).toHaveBeenCalledWith('claude@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Add All On Call (2)' }));
    expect(onAddAllSuggestions).toHaveBeenCalledTimes(1);
  });

  it('lists teams with no coverage under On call now with an Assign On-Call link', () => {
    const onAssignOnCall = vi.fn();
    render(
      <CompositionList
        log={[]}
        itemData={mockItemData as never}
        onScroll={vi.fn()}
        vacantOnCallTeams={['Payments Escalation']}
        onAssignOnCall={onAssignOnCall}
      />,
    );

    // Shown even when nobody is left to add: the gap itself is what the operator must see.
    expect(screen.getByRole('heading', { name: 'On call now' })).toBeInTheDocument();
    const vacancies = screen.getByRole('list', { name: 'Teams with no coverage' });
    expect(vacancies).toHaveTextContent('Payments Escalation — No coverage');
    const assign = screen.getByRole('button', { name: 'Assign On-Call for Payments Escalation' });
    expect(assign).toHaveTextContent('Assign On-Call');
    fireEvent.click(assign);
    expect(onAssignOnCall).toHaveBeenCalledTimes(1);
  });

  it('keeps vacancies beside the quick-add strip once recipients exist', () => {
    const log = [{ email: 'hedy@example.com', source: 'manual' }];
    render(
      <CompositionList
        log={log}
        itemData={{ ...mockItemData, log } as never}
        onScroll={vi.fn()}
        onCallSuggestions={[
          {
            email: 'ada@example.com',
            name: 'Ada Lovelace',
            role: 'Primary',
            roleKind: 'primary',
            team: 'Database',
          },
        ]}
        onAddSuggestion={vi.fn()}
        vacantOnCallTeams={['Payments Escalation', 'Facilities']}
      />,
    );

    const vacancies = screen.getByRole('list', { name: 'Teams with no coverage' });
    expect(vacancies.querySelectorAll('li')).toHaveLength(2);
    // Without a navigation handler the row still names the gap, just without a dead link.
    expect(screen.queryByRole('button', { name: /Assign On-Call/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Add Ada Lovelace, Primary, Database' }),
    ).toBeVisible();
  });

  it('renders no On call now section when nobody is missing and every team is covered', () => {
    render(<CompositionList log={[]} itemData={mockItemData as never} onScroll={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'On call now' })).toBeNull();
  });

  it('removes the focused recipient on Delete or Backspace', () => {
    const onRemoveManual = vi.fn();
    const log = [
      { email: 'a@b.com', source: 'manual' },
      { email: 'c@d.com', source: 'group' },
    ];
    render(
      <CompositionList
        log={log}
        itemData={{ ...mockItemData, log, onRemoveManual } as never}
        onScroll={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('row-0'), { key: 'Delete' });
    expect(onRemoveManual).toHaveBeenCalledWith('a@b.com');
    fireEvent.keyDown(screen.getByTestId('row-1'), { key: 'Backspace' });
    expect(onRemoveManual).toHaveBeenCalledWith('c@d.com');
    fireEvent.keyDown(screen.getByTestId('row-1'), { key: 'Enter' });
    expect(onRemoveManual).toHaveBeenCalledTimes(2);
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
