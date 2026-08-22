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
type ConfirmPayload = { team: string; onConfirm: () => void } | null;

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

  it('shows empty state when rows are empty', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    expect(screen.getByText('Click to assign personnel')).toBeInTheDocument();
  });

  it('shows empty state for a single row with no name and no contact', () => {
    render(<TeamCard {...defaultProps()} rows={[makeRow({ name: '', contact: '' })]} />);
    expect(screen.getByText('Click to assign personnel')).toBeInTheDocument();
  });

  it('shows readonly empty state when isReadOnly and empty', () => {
    render(<TeamCard {...defaultProps()} rows={[]} isReadOnly />);
    expect(screen.getByText('No personnel assigned')).toBeInTheDocument();
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

  it('opens edit modal when empty state button is clicked', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    fireEvent.click(screen.getByText('Click to assign personnel'));
    expect(screen.getByTestId('maintain-modal')).toBeInTheDocument();
  });

  it('opens edit modal on Enter key in empty state', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    const btn = screen.getByText('Click to assign personnel');
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(screen.getByTestId('maintain-modal')).toBeInTheDocument();
  });

  it('opens edit modal on Space key in empty state', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    const btn = screen.getByText('Click to assign personnel');
    fireEvent.keyDown(btn, { key: ' ' });
    expect(screen.getByTestId('maintain-modal')).toBeInTheDocument();
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
    expect(setConfirm).toHaveBeenCalledWith(expect.objectContaining({ team: 'Alpha' }));
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
    expect(screen.getByText('Click to assign personnel')).toBeInTheDocument();
  });
});
