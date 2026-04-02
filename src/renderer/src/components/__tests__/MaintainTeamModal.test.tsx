import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MaintainTeamModal } from '../MaintainTeamModal';
import type { OnCallRow, Contact } from '@shared/ipc';

const contacts: Contact[] = [
  {
    id: '1',
    name: 'Alice',
    email: 'alice@example.com',
    phone: '5551234567',
    businessArea: '',
    lob: '',
    comment: '',
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

describe('MaintainTeamModal', () => {
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

  it('clicking Add Row adds a new row', () => {
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
    const onSave = vi.fn();
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
    const onSave = vi.fn();
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
    const savedRows = onSave.mock.calls[0][1] as OnCallRow[];
    expect(savedRows[0].role).toBe('Member');
  });

  it('preserves non-empty role on save', () => {
    const onSave = vi.fn();
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
    const savedRows = onSave.mock.calls[0][1] as OnCallRow[];
    expect(savedRows[0].role).toBe('Lead');
  });

  it('handles adding and then saving multiple rows', () => {
    const onSave = vi.fn();
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
    const savedRows = onSave.mock.calls[0][1] as OnCallRow[];
    expect(savedRows).toHaveLength(2);
  });
});
