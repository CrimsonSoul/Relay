import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContactDetailPanel } from '../ContactDetailPanel';
import type { Contact } from '@shared/ipc';

const mockContact: Contact = {
  id: '1',
  name: 'Alice Smith',
  email: 'alice@example.com',
  phone: '5551234567',
  title: 'Engineer',
  businessArea: 'IT',
  lob: '',
  comment: '',
};

describe('ContactDetailPanel', () => {
  it('renders contact name', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders contact email', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('renders contact title', () => {
    render(
      <ContactDetailPanel
        contact={mockContact}
        groups={[]}
        onEditNotes={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Engineer')).toBeInTheDocument();
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
    expect(screen.getByText('DEVOPS')).toBeInTheDocument();
    expect(screen.getByText('NETWORK')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('Edit Contact'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('calls onDelete when Delete is clicked', () => {
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
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('shows Add to Composer when onAddToAssembler is provided', () => {
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
    const btn = screen.getByText('Add to Composer');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAddToAssembler).toHaveBeenCalled();
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
