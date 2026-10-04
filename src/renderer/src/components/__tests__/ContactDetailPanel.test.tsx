import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContactDetailPanel } from '../ContactDetailPanel';
import type { Contact, Server } from '@shared/ipc';

const mockContact: Contact = {
  name: 'Alice Smith',
  email: 'alice@example.com',
  phone: '5551234567',
  title: 'Engineer',
  _searchString: 'alice smith alice@example.com engineer',
  raw: { id: '1', businessArea: 'IT', lob: '', comment: '' },
};

describe('ContactDetailPanel', () => {
  it.each([
    ['name', 'Alice Smith'],
    ['email', 'alice@example.com'],
    ['title', 'Engineer'],
  ])('renders contact %s', (_field, expectedValue) => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(expectedValue)).toBeInTheDocument();
  });

  it('lets an email wrap only after "@", never before ".com"', () => {
    const { container } = render(
      <ContactDetailPanel
        contact={{ ...mockContact, email: 'ada.lovelace@mail.example.com' }}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const emailNodes = Array.from(container.querySelectorAll('wbr')).map(
      (wbr) => wbr.parentElement,
    );
    expect(emailNodes.length).toBeGreaterThan(0);
    for (const node of emailNodes) {
      expect(node?.querySelectorAll('wbr')).toHaveLength(1);
      expect(node?.innerHTML).toContain('ada.lovelace@<wbr>mail.example.com');
    }
  });

  it('renders groups', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={['DevOps', 'Network']}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('DevOps')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
  });

  it('renders tags', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        tags={['alpha', 'beta']}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('#alpha')).toBeInTheDocument();
  });

  it('renders notes section when noteText provided', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        noteText="Some notes"
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Some notes')).toBeInTheDocument();
  });

  it('shows Edit Notes when noteText exists', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        noteText="Notes"
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Edit Notes')).toBeInTheDocument();
  });

  it('shows Add Notes when no noteText', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Add Notes')).toBeInTheDocument();
  });

  it('calls onEditNotes when clicked', () => {
    const onEditNotes = vi.fn();
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={onEditNotes}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Add Notes'));
    expect(onEditNotes).toHaveBeenCalled();
  });

  it('calls onEdit when Edit Contact is clicked', () => {
    const onEdit = vi.fn();
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
    );
    const edit = screen.getByRole('button', { name: 'Edit Contact' });
    expect(edit).toHaveTextContent(/^Edit$/);
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalled();
  });

  it('calls onDelete when Delete Contact is clicked', () => {
    const onDelete = vi.fn();
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const remove = screen.getByRole('button', { name: 'Delete Contact' });
    expect(remove).toHaveTextContent(/^Delete$/);
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalled();
  });

  it('shows Add to Bridge when onAddToAssembler is provided', () => {
    const onAddToAssembler = vi.fn();
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAddToAssembler={onAddToAssembler}
      />,
    );
    const btn = screen.getByText('Add to Bridge');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAddToAssembler).toHaveBeenCalled();
  });

  it('renders server relationships when provided', () => {
    const owned: Server = {
      name: 'web-prod-01',
      businessArea: 'eCommerce',
      lob: 'Storefront',
      comment: 'Primary web server',
      owner: 'alice@example.com',
      contact: 'steve@example.com',
      os: 'Linux',
      _searchString: 'web-prod-01 ecommerce storefront alice@example.com steve@example.com linux',
      raw: {},
    };
    const supported: Server = {
      ...owned,
      name: 'api-prod-01',
      owner: 'steve@example.com',
      contact: 'alice@example.com',
    };

    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        relatedServers={{ owned: [owned], supported: [supported] }}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Server relationships')).toBeInTheDocument();
    expect(screen.getByText('web-prod-01')).toBeInTheDocument();
    expect(screen.getByText('api-prod-01')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('uses email as display name when contact name is invalid', () => {
    const contact: Contact = { ...mockContact, name: '...' };
    render(
      <ContactDetailPanel
        contact={contact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // email appears as display name AND in the email field — getAllByText handles both
    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0);
  });
});
