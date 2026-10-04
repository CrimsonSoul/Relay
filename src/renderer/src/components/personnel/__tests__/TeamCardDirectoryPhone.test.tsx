import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TeamCard } from '../TeamCard';
import type { OnCallRow, Contact } from '@shared/ipc';

// Renders the real TeamRow so the card-level fallback is checked end to end.
vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

vi.mock('../../MaintainTeamModal', () => ({
  MaintainTeamModal: () => null,
}));

const row = (overrides: Partial<OnCallRow> = {}): OnCallRow => ({
  id: 'r1',
  team: 'Alpha',
  teamId: 'alpha',
  role: 'Primary',
  name: 'Alice',
  contact: '',
  ...overrides,
});

const contact = (name: string, phone: string): Contact => ({
  name,
  email: `${name.toLowerCase()}.${phone.slice(-4)}@example.com`,
  phone,
  title: '',
  _searchString: name.toLowerCase(),
  raw: {},
});

const renderCard = (contacts: Contact[]) =>
  render(
    <TeamCard
      team="Alpha"
      rows={[row()]}
      contacts={contacts}
      onUpdateRows={vi.fn()}
      onRenameTeam={vi.fn()}
      onRemoveTeam={vi.fn()}
      setConfirm={vi.fn()}
      setMenu={vi.fn()}
    />,
  );

describe('TeamCard — directory phone fallback', () => {
  it('shows the unique directory number, marked "from Contacts", and does not flag the row', () => {
    renderCard([contact('alice', '555-0100')]);

    const phone = screen.getByRole('button', { name: 'Copy contact 555-0100 (from Contacts)' });
    expect(phone).toBeEnabled();
    expect(within(phone).getByText('from Contacts')).toBeInTheDocument();
    expect(screen.queryByText('Needs contact')).not.toBeInTheDocument();
  });

  it('still flags the row and shows no number when the directory match is ambiguous', () => {
    renderCard([contact('Alice', '555-0100'), contact('Alice', '555-0199')]);

    expect(screen.getByText('Needs contact')).toBeInTheDocument();
    expect(screen.queryByText('from Contacts')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No contact available' })).toBeDisabled();
  });
});
