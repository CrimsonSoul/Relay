import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamCard } from '../TeamCard';
import type { ContextMenuItem } from '../../ContextMenu';
import type { OnCallRow, Contact } from '@shared/ipc';

// Mock dependencies
vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

vi.mock('../../MaintainTeamModal', () => ({
  MaintainTeamModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="maintain-modal">modal</div> : null,
}));

vi.mock('../../ContextMenu', () => ({}));

vi.mock('../TeamRow', () => ({
  TeamRow: ({ row }: { row: OnCallRow }) => (
    <div data-testid={`team-row-${row.id}`}>{row.name}</div>
  ),
}));

vi.mock('../../../utils/colors', () => ({
  getColorForString: () => ({
    bg: 'rgba(0,0,0,0.2)',
    border: 'rgba(0,0,0,0.4)',
    text: '#fff',
    fill: '#000',
  }),
}));

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'r1',
  team: 'Alpha',
  teamId: 't1',
  role: 'Primary',
  name: 'Alice',
  contact: '555-1234',
  ...overrides,
});

const defaultProps = () => ({
  team: 'Alpha',
  rows: [makeRow()],
  contacts: [] as Contact[],
  onUpdateRows: vi.fn(),
  onRenameTeam: vi.fn(),
  onRemoveTeam: vi.fn(),
  setConfirm: vi.fn(),
  setMenu: vi.fn(),
});

type ContextMenuPayload = { x: number; y: number; items: ContextMenuItem[] } | null;
type ConfirmPayload = { team: string; memberCount: number; onConfirm: () => void } | null;

const makeSetMenu = () => vi.fn<(menu: ContextMenuPayload) => void>();
const makeSetConfirm = () => vi.fn<(confirm: ConfirmPayload) => void>();

/** Pulls a labelled entry out of a captured setMenu payload, failing loudly if it is absent. */
const menuItem = (menu: ContextMenuPayload | undefined, label: string): ContextMenuItem => {
  const item = menu?.items.find((entry) => entry.label === label);
  if (!item) throw new Error(`Expected a context menu item labelled "${label}"`);
  return item;
};

const confirmPayload = (confirm: ConfirmPayload | undefined): NonNullable<ConfirmPayload> => {
  if (!confirm) throw new Error('Expected setConfirm to receive a confirmation payload');
  return confirm;
};

describe('TeamCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes active coverage when the minute tick crosses the window end', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 10, 16, 59));
      const props = { ...defaultProps(), rows: [makeRow({ timeWindow: '09:00-17:00' })] };
      const { rerender } = render(<TeamCard {...props} tick={Date.now()} />);
      expect(screen.getByText('1 active')).toBeInTheDocument();
      vi.setSystemTime(new Date(2026, 8, 10, 17, 1));
      rerender(<TeamCard {...props} tick={Date.now()} />);
      expect(screen.queryByText('1 active')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders team name and rows', () => {
    render(<TeamCard {...defaultProps()} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('team-row-r1')).toBeInTheDocument();
  });

  it('shows a health badge for active coverage', () => {
    render(<TeamCard {...defaultProps()} rows={[makeRow({ timeWindow: 'always' })]} />);
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it('does not show a health chip for a team with primary-only coverage', () => {
    const { container } = render(
      <TeamCard {...defaultProps()} rows={[makeRow({ role: 'Primary' })]} />,
    );
    expect(screen.queryByText('No backup')).not.toBeInTheDocument();
    expect(screen.queryByText('Covered')).not.toBeInTheDocument();
    expect(container.querySelector('.team-health-badge')).not.toBeInTheDocument();
  });

  it('does not show a health chip for a team with primary and backup coverage', () => {
    const { container } = render(
      <TeamCard
        {...defaultProps()}
        rows={[makeRow({ role: 'Primary' }), makeRow({ id: 'r2', role: 'Backup' })]}
      />,
    );
    expect(screen.queryByText('No backup')).not.toBeInTheDocument();
    expect(screen.queryByText('Covered')).not.toBeInTheDocument();
    expect(container.querySelector('.team-health-badge')).not.toBeInTheDocument();
  });

  const directoryContact = (name: string, phone: string): Contact => ({
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
    phone,
    title: '',
    _searchString: name.toLowerCase(),
    raw: {},
  });

  it('flags a member with no number when the directory cannot supply one', () => {
    render(<TeamCard {...defaultProps()} rows={[makeRow({ contact: '' })]} />);
    expect(screen.getByText('Needs contact')).toBeInTheDocument();
  });

  it('does not flag a member whose name matches exactly one directory contact with a phone', () => {
    render(
      <TeamCard
        {...defaultProps()}
        rows={[makeRow({ contact: '' })]}
        contacts={[directoryContact('alice', '555-0100')]}
      />,
    );
    expect(screen.queryByText('Needs contact')).not.toBeInTheDocument();
  });

  it('still flags the member when the directory match is ambiguous', () => {
    render(
      <TeamCard
        {...defaultProps()}
        rows={[makeRow({ contact: '' })]}
        contacts={[directoryContact('Alice', '555-0100'), directoryContact('Alice', '555-0199')]}
      />,
    );
    expect(screen.getByText('Needs contact')).toBeInTheDocument();
  });

  it('shows a No coverage status with a secondary Assign action when rows are empty', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    expect(screen.getByText('No coverage')).toHaveClass('team-card-empty-status');
    expect(screen.getByRole('button', { name: 'Assign On-Call for Alpha' })).toHaveTextContent(
      'Assign On-Call',
    );
    expect(screen.queryByText('Empty')).toBeNull();
  });

  it('shows empty state for a single row with no name and no contact', () => {
    render(<TeamCard {...defaultProps()} rows={[makeRow({ name: '', contact: '' })]} />);
    expect(screen.getByText('No coverage')).toBeInTheDocument();
  });

  it('shows readonly empty state without the Assign action', () => {
    render(<TeamCard {...defaultProps()} rows={[]} isReadOnly />);
    expect(screen.getByText('No coverage')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assign On-Call/ })).toBeNull();
  });

  it('applies readonly class when isReadOnly', () => {
    const { container } = render(<TeamCard {...defaultProps()} isReadOnly />);
    const card = container.querySelector('.team-card-body');
    expect(card?.className).toContain('team-card-body--readonly');
  });

  it('applies lift-on-hover class when not readonly', () => {
    const { container } = render(<TeamCard {...defaultProps()} />);
    const card = container.querySelector('.team-card-body');
    expect(card?.className).toContain('lift-on-hover');
  });

  it('opens edit modal when the Assign button is clicked', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Assign On-Call for Alpha' }));
    expect(screen.getByTestId('maintain-modal')).toBeInTheDocument();
  });

  it('is a focusable, labelled card', () => {
    render(<TeamCard {...defaultProps()} />);
    const card = screen.getByRole('group', { name: 'Alpha team' });
    expect(card).toHaveAttribute('tabindex', '0');
    expect(card).toHaveClass('team-card-body');
  });

  it('opens the team menu from the visible actions button', () => {
    const setMenu = makeSetMenu();
    render(<TeamCard {...defaultProps()} setMenu={setMenu} />);
    const button = screen.getByRole('button', {
      name: 'Alpha Team Actions: Edit, Rename, Remove',
    });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Shift+F10');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(button);
    const menu = setMenu.mock.calls[0]?.[0];
    expect(menu?.items.map((item) => item.label)).toEqual([
      'Edit Team',
      'Rename Team',
      'Remove Team',
    ]);
  });

  it.each([
    ['Shift+F10', { key: 'F10', shiftKey: true }],
    ['ContextMenu', { key: 'ContextMenu' }],
  ])('opens the team menu with %s on the focused card', (_label, keyInit) => {
    const setMenu = makeSetMenu();
    render(<TeamCard {...defaultProps()} setMenu={setMenu} />);
    const card = screen.getByRole('group', { name: 'Alpha team' });
    card.focus();
    fireEvent.keyDown(card, keyInit);
    expect(setMenu).toHaveBeenCalledTimes(1);
    expect(menuItem(setMenu.mock.calls[0]?.[0], 'Remove Team')).toBeDefined();
  });

  it('hides the actions button when the menu would be empty', () => {
    render(<TeamCard {...defaultProps()} isReadOnly />);
    expect(screen.queryByRole('button', { name: /Team Actions/ })).toBeNull();
  });

  it('handles rows with timeWindow (hasAnyTimeWindow branch)', () => {
    render(<TeamCard {...defaultProps()} rows={[makeRow({ timeWindow: '09:00-17:00' })]} />);
    expect(screen.getByTestId('team-row-r1')).toBeInTheDocument();
  });

  it('opens context menu with readonly + onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const onCopyTeamInfo = vi.fn();
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} isReadOnly onCopyTeamInfo={onCopyTeamInfo} />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    expect(setMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ label: 'Copy On-Call Info' })]),
      }),
    );
  });

  it('opens context menu with readonly without onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const { container } = render(<TeamCard {...defaultProps()} setMenu={setMenu} isReadOnly />);
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    expect(setMenu).toHaveBeenCalledWith(expect.objectContaining({ items: [] }));
  });

  it('opens context menu in edit mode with onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const onCopyTeamInfo = vi.fn();
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} onCopyTeamInfo={onCopyTeamInfo} />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    expect(setMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ label: 'Copy On-Call Info' }),
          expect.objectContaining({ label: 'Edit Team' }),
          expect.objectContaining({ label: 'Rename Team' }),
          expect.objectContaining({ label: 'Remove Team' }),
        ]),
      }),
    );
  });

  it('opens context menu in edit mode without onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const { container } = render(<TeamCard {...defaultProps()} setMenu={setMenu} />);
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    expect(setMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ label: 'Edit Team' }),
          expect.objectContaining({ label: 'Rename Team' }),
          expect.objectContaining({ label: 'Remove Team' }),
        ]),
      }),
    );
  });

  it('context menu Copy On-Call Info calls onCopyTeamInfo', () => {
    const setMenu = makeSetMenu();
    const onCopyTeamInfo = vi.fn();
    const rows = [makeRow()];
    const { container } = render(
      <TeamCard
        {...defaultProps()}
        rows={rows}
        setMenu={setMenu}
        onCopyTeamInfo={onCopyTeamInfo}
      />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    // Extract the onClick from the Copy On-Call Info item
    const copyItem = menuItem(setMenu.mock.calls[0]?.[0], 'Copy On-Call Info');
    copyItem.onClick();
    expect(onCopyTeamInfo).toHaveBeenCalledWith('Alpha', rows);
  });

  it('context menu Edit Team opens modal', () => {
    const setMenu = makeSetMenu();
    const { container } = render(<TeamCard {...defaultProps()} setMenu={setMenu} />);
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    const editItem = menuItem(setMenu.mock.calls[0]?.[0], 'Edit Team');
    act(() => {
      editItem.onClick();
    });
    expect(screen.getByTestId('maintain-modal')).toBeInTheDocument();
  });

  it('context menu Rename Team calls onRenameTeam', () => {
    const setMenu = makeSetMenu();
    const onRenameTeam = vi.fn();
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} onRenameTeam={onRenameTeam} />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    const renameItem = menuItem(setMenu.mock.calls[0]?.[0], 'Rename Team');
    renameItem.onClick();
    expect(onRenameTeam).toHaveBeenCalledWith('Alpha', 'Alpha');
  });

  it('context menu Remove Team calls setConfirm', () => {
    const setMenu = makeSetMenu();
    const setConfirm = makeSetConfirm();
    const onRemoveTeam = vi.fn();
    const { container } = render(
      <TeamCard
        {...defaultProps()}
        setMenu={setMenu}
        setConfirm={setConfirm}
        onRemoveTeam={onRemoveTeam}
      />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    const removeItem = menuItem(setMenu.mock.calls[0]?.[0], 'Remove Team');
    removeItem.onClick();
    expect(setConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ team: 'Alpha', memberCount: 1 }),
    );
    // Execute the confirm callback
    confirmPayload(setConfirm.mock.calls[0]?.[0]).onConfirm();
    expect(onRemoveTeam).toHaveBeenCalledWith('Alpha');
  });

  it('drops stale callback closures when only the handlers change', () => {
    const setMenu = makeSetMenu();
    const setConfirm = makeSetConfirm();
    const staleRemoveTeam = vi.fn();
    const freshRemoveTeam = vi.fn();
    // Everything a drag reorder leaves untouched on an unmoved card: same
    // rows, same contacts, same index — only the rebuilt handlers differ.
    const stableProps = { ...defaultProps(), setMenu, setConfirm };

    const { container, rerender } = render(
      <TeamCard {...stableProps} onRemoveTeam={staleRemoveTeam} />,
    );
    rerender(<TeamCard {...stableProps} onRemoveTeam={freshRemoveTeam} />);

    fireEvent.contextMenu(container.querySelector('.team-card-body')!);
    const removeItem = menuItem(setMenu.mock.calls.at(-1)?.[0], 'Remove Team');
    removeItem.onClick();
    confirmPayload(setConfirm.mock.calls.at(-1)?.[0]).onConfirm();

    expect(freshRemoveTeam).toHaveBeenCalledWith('Alpha');
    expect(staleRemoveTeam).not.toHaveBeenCalled();
  });

  it('handles null rows gracefully (rows || [] fallback)', () => {
    render(<TeamCard {...defaultProps()} rows={null as unknown as OnCallRow[]} />);
    // Empty state should show since rows is null -> []
    expect(screen.getByText('No coverage')).toBeInTheDocument();
  });
});
