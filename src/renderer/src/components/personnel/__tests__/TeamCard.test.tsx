import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamCard } from '../TeamCard';
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

describe('TeamCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders team name and rows', () => {
    render(<TeamCard {...defaultProps()} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('team-row-r1')).toBeInTheDocument();
  });

  it('shows empty state when rows are empty', () => {
    render(<TeamCard {...defaultProps()} rows={[]} />);
    expect(screen.getByText('Click to assign personnel')).toBeInTheDocument();
  });

  it('shows empty state for a single row with no name and no contact', () => {
    render(
      <TeamCard
        {...defaultProps()}
        rows={[makeRow({ name: '', contact: '' })]}
      />,
    );
    expect(screen.getByText('Click to assign personnel')).toBeInTheDocument();
  });

  it('shows readonly empty state when isReadOnly and empty', () => {
    render(<TeamCard {...defaultProps()} rows={[]} isReadOnly />);
    expect(screen.getByText('No personnel assigned')).toBeInTheDocument();
  });

  it('applies readonly class when isReadOnly', () => {
    const { container } = render(
      <TeamCard {...defaultProps()} isReadOnly />,
    );
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
    render(
      <TeamCard
        {...defaultProps()}
        rows={[makeRow({ timeWindow: '09:00-17:00' })]}
      />,
    );
    expect(screen.getByTestId('team-row-r1')).toBeInTheDocument();
  });

  it('opens context menu with readonly + onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const onCopyTeamInfo = vi.fn();
    const { container } = render(
      <TeamCard
        {...defaultProps()}
        setMenu={setMenu}
        isReadOnly
        onCopyTeamInfo={onCopyTeamInfo}
      />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    expect(setMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ label: 'Copy On-Call Info' }),
        ]),
      }),
    );
  });

  it('opens context menu with readonly without onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} isReadOnly />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    expect(setMenu).toHaveBeenCalledWith(
      expect.objectContaining({ items: [] }),
    );
  });

  it('opens context menu in edit mode with onCopyTeamInfo', () => {
    const setMenu = vi.fn();
    const onCopyTeamInfo = vi.fn();
    const { container } = render(
      <TeamCard
        {...defaultProps()}
        setMenu={setMenu}
        onCopyTeamInfo={onCopyTeamInfo}
      />,
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
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} />,
    );
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
    const setMenu = vi.fn();
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
    const copyItem = setMenu.mock.calls[0][0].items.find(
      (i: { label: string }) => i.label === 'Copy On-Call Info',
    );
    copyItem.onClick();
    expect(onCopyTeamInfo).toHaveBeenCalledWith('Alpha', rows);
  });

  it('context menu Edit Team opens modal', () => {
    const setMenu = vi.fn();
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    const editItem = setMenu.mock.calls[0][0].items.find(
      (i: { label: string }) => i.label === 'Edit Team',
    );
    act(() => {
      editItem.onClick();
    });
    expect(screen.getByTestId('maintain-modal')).toBeInTheDocument();
  });

  it('context menu Rename Team calls onRenameTeam', () => {
    const setMenu = vi.fn();
    const onRenameTeam = vi.fn();
    const { container } = render(
      <TeamCard {...defaultProps()} setMenu={setMenu} onRenameTeam={onRenameTeam} />,
    );
    const card = container.querySelector('.team-card-body')!;
    fireEvent.contextMenu(card);
    const renameItem = setMenu.mock.calls[0][0].items.find(
      (i: { label: string }) => i.label === 'Rename Team',
    );
    renameItem.onClick();
    expect(onRenameTeam).toHaveBeenCalledWith('Alpha', 'Alpha');
  });

  it('context menu Remove Team calls setConfirm', () => {
    const setMenu = vi.fn();
    const setConfirm = vi.fn();
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
    const removeItem = setMenu.mock.calls[0][0].items.find(
      (i: { label: string }) => i.label === 'Remove Team',
    );
    removeItem.onClick();
    expect(setConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ team: 'Alpha' }),
    );
    // Execute the confirm callback
    setConfirm.mock.calls[0][0].onConfirm();
    expect(onRemoveTeam).toHaveBeenCalledWith('Alpha');
  });

  it('handles null rows gracefully (rows || [] fallback)', () => {
    render(
      <TeamCard
        {...defaultProps()}
        rows={null as unknown as OnCallRow[]}
      />,
    );
    // Empty state should show since rows is null -> []
    expect(screen.getByText('Click to assign personnel')).toBeInTheDocument();
  });
});
