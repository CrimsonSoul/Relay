import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MaintainTeamModal } from '../MaintainTeamModal';
import type { OnCallRow, Contact } from '@shared/ipc';

const contacts: Contact[] = [
  {
    name: 'Alice',
    email: 'alice@example.com',
    phone: '5551234567',
    title: '',
    _searchString: 'alice alice@example.com',
    raw: { id: '1' },
  },
];

const makeRow = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'row-1',
  team: 'Alpha',
  teamId: 'alpha',
  role: 'Primary',
  name: 'Bob',
  contact: '5559876543',
  timeWindow: '',
  ...overrides,
});

const makeOnSave = () => vi.fn<(team: string, rows: OnCallRow[]) => void>();

/** Rows handed to the first onSave call; throws rather than silently reading undefined. */
const savedRowsOf = (onSave: ReturnType<typeof makeOnSave>): OnCallRow[] => {
  const firstCall = onSave.mock.calls[0];
  if (!firstCall) throw new Error('Expected onSave to have been called');
  return firstCall[1];
};

describe('MaintainTeamModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render when isOpen is false', () => {
    render(
      <MaintainTeamModal
        isOpen={false}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={vi.fn()}
      />,
    );
    const dialog = document.querySelector('dialog');
    expect(!dialog || !dialog.hasAttribute('open')).toBe(true);
  });

  it('renders modal with team name in title', () => {
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('Edit Card: Alpha')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-variant', 'large');
    expect(dialog.querySelector('.modal-footer-generic')).not.toBeNull();
  });

  it('renders initial rows', () => {
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[makeRow()]}
        contacts={contacts}
        onSave={vi.fn()}
      />,
    );
    // Row has a phone field with the value
    expect(screen.getByDisplayValue('5559876543')).toBeInTheDocument();
  });

  it('renders Add Row button', () => {
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('+ Add Row')).toBeInTheDocument();
  });

  it('clicking Add Row adds a new row when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(11),
    });
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('+ Add Row'));
    // New row appears — a phone input placeholder
    expect(screen.getAllByPlaceholderText('Phone').length).toBeGreaterThan(0);
  });

  it('calls onSave and onClose when Save Changes is clicked', () => {
    const onSave = makeOnSave();
    const onClose = vi.fn();
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={onClose}
        teamName="Alpha"
        initialRows={[makeRow()]}
        contacts={contacts}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave).toHaveBeenCalledWith('Alpha', expect.any(Array));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={onClose}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('removes a row when remove button is clicked', () => {
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[makeRow()]}
        contacts={contacts}
        onSave={vi.fn()}
      />,
    );
    // There should be a remove button
    const removeBtn = screen.getByLabelText('Remove row');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    // After removal the phone input should no longer be there
    expect(screen.queryByDisplayValue('5559876543')).toBeNull();
  });

  it('defaults empty role to "Member" on save', () => {
    const onSave = makeOnSave();
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[makeRow({ role: '   ' })]}
        contacts={contacts}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText('Save Changes'));
    const savedRows = savedRowsOf(onSave);
    expect(savedRows[0]?.role).toBe('Member');
  });

  it('preserves non-empty role on save', () => {
    const onSave = makeOnSave();
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[makeRow({ role: 'Lead' })]}
        contacts={contacts}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText('Save Changes'));
    const savedRows = savedRowsOf(onSave);
    expect(savedRows[0]?.role).toBe('Lead');
  });

  it('handles adding and then saving multiple rows', () => {
    const onSave = makeOnSave();
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByText('+ Add Row'));
    fireEvent.click(screen.getByText('+ Add Row'));
    fireEvent.click(screen.getByText('Save Changes'));
    const savedRows = savedRowsOf(onSave);
    expect(savedRows).toHaveLength(2);
  });

  it('keeps unsaved rows when the initialRows array identity changes while open', () => {
    const onSave = makeOnSave();
    const { rerender } = render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByText('+ Add Row'));
    const [phoneInput] = screen.getAllByPlaceholderText('Phone');
    if (!phoneInput) throw new Error('Expected the added row to render a Phone input');
    fireEvent.change(phoneInput, { target: { value: '5550001111' } });

    // PersonnelTab resolves an empty team through `|| []`, so every render — and
    // every 60s alert-dismissal tick — hands the modal a brand new array.
    rerender(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={onSave}
      />,
    );

    expect(screen.getByDisplayValue('5550001111')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save Changes'));
    const savedRows = savedRowsOf(onSave);
    expect(savedRows).toHaveLength(1);
    expect(savedRows[0]?.contact).toBe('5550001111');
  });

  it('re-seeds the draft from initialRows on the next open', () => {
    const { rerender } = render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[]}
        contacts={[]}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('+ Add Row'));

    const reopen = (isOpen: boolean) =>
      rerender(
        <MaintainTeamModal
          isOpen={isOpen}
          onClose={vi.fn()}
          teamName="Alpha"
          initialRows={[makeRow()]}
          contacts={contacts}
          onSave={vi.fn()}
        />,
      );
    reopen(false);
    reopen(true);

    expect(screen.getByDisplayValue('5559876543')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('Phone')).toHaveLength(1);
  });

  it('saves newly added rows with the existing teamId', () => {
    const onSave = makeOnSave();
    render(
      <MaintainTeamModal
        isOpen={true}
        onClose={vi.fn()}
        teamName="Alpha"
        initialRows={[makeRow({ teamId: 'alpha-team-id' })]}
        contacts={[]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByText('+ Add Row'));
    fireEvent.click(screen.getByText('Save Changes'));

    const savedRows = savedRowsOf(onSave);
    expect(savedRows[1]?.teamId).toBe('alpha-team-id');
  });
});
