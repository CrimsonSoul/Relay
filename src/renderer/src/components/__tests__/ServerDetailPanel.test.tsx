import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Contact, Server } from '@shared/ipc';
import { ServerDetailPanel } from '../ServerDetailPanel';

const server: Server = {
  name: 'batch-etl-07',
  businessArea: 'Analytics',
  lob: 'Data Platform',
  comment: '',
  owner: 'Alan Turing',
  contact: 'alan.turing@example.com',
  os: 'Windows',
  _searchString: 'batch-etl-07',
  raw: {},
};

const alan: Contact = {
  name: 'Alan Turing',
  email: 'alan.turing@example.com',
  phone: '',
  title: '',
  _searchString: 'alan turing',
  raw: {},
};

const renderPanel = (onDelete = vi.fn()) =>
  render(
    <ServerDetailPanel
      server={server}
      contactLookup={
        new Map([
          ['alan turing', alan],
          ['alan.turing@example.com', alan],
        ])
      }
      onEditNotes={vi.fn()}
      onEdit={vi.fn()}
      onDelete={onDelete}
    />,
  );

describe('ServerDetailPanel', () => {
  it('shows the person sub line only when it adds an identifier beyond the name', () => {
    renderPanel();

    // Owner was recorded by name, so repeating it underneath adds nothing.
    expect(screen.getAllByText('Alan Turing')).toHaveLength(2);
    expect(screen.getByText('alan.turing@example.com')).toHaveClass('detail-panel-field-sub');
  });

  it('shows short verbs and names each action with its record type', () => {
    const onDelete = vi.fn();
    renderPanel(onDelete);

    expect(screen.getByRole('button', { name: 'Edit Server' })).toHaveTextContent(/^Edit$/);
    expect(screen.getByRole('button', { name: 'Add Notes' })).toHaveTextContent(/^Add Notes$/);
    const remove = screen.getByRole('button', { name: 'Delete Server' });
    expect(remove).toHaveTextContent(/^Delete$/);
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalled();
  });
});
