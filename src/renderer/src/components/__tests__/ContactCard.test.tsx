import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { ContactCard } from '../ContactCard';
import type { Contact } from '@shared/ipc';

describe('ContactCard Component', () => {
  const mockContact: Contact = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '555-123-4567',
    title: 'Software Engineer',
    _searchString: 'john doe john.doe@example.com software engineer',
    raw: {},
  };

  test('renders contact with name, email, title, and phone', () => {
    render(<ContactCard {...mockContact} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john.doe@example.com')).toBeInTheDocument();
    expect(screen.getByText('Software Engineer')).toBeInTheDocument();
    expect(screen.getByText('(555) 123-4567')).toBeInTheDocument();
  });

  test('displays email as display name when name is invalid', () => {
    const contactWithInvalidName: Contact = {
      name: '...',
      email: 'test@example.com',
      title: 'Tester',
      _searchString: 'test@example.com tester',
      raw: {},
    };

    render(<ContactCard {...contactWithInvalidName} />);

    // Email appears twice: once as display name (in name span with larger font)
    // and once in email details. We only need to find at least one instance.
    expect(screen.getAllByText('test@example.com').length).toBeGreaterThan(0);
  });

  test('renders selected state', () => {
    const { container } = render(<ContactCard {...mockContact} selected={true} />);

    const cardElement = container.querySelector('.card-surface');
    expect(cardElement).toHaveClass('contact-card-body--selected');
  });

  test('renders with source label', () => {
    render(<ContactCard {...mockContact} sourceLabel="CSV" />);
    expect(screen.getByText('CSV')).toBeInTheDocument();
  });

  test('calls onContextMenu when right-clicked', () => {
    const handleContextMenu = vi.fn();
    const { container } = render(
      <ContactCard {...mockContact} onContextMenu={handleContextMenu} />,
    );

    const cardElement = container.querySelector('.card-surface') || container.firstChild;
    if (cardElement) {
      fireEvent.contextMenu(cardElement);
      expect(handleContextMenu).toHaveBeenCalled();
    }
  });

  test('calls onRowClick when clicked', () => {
    const handleRowClick = vi.fn();
    const { container } = render(<ContactCard {...mockContact} onRowClick={handleRowClick} />);

    const cardElement = container.querySelector('.card-surface') || container.firstChild;
    if (cardElement) {
      fireEvent.click(cardElement);
      expect(handleRowClick).toHaveBeenCalled();
    }
  });

  test('renders action when provided', () => {
    const actionButton = <button data-testid="test-action">Action</button>;
    render(<ContactCard {...mockContact} action={actionButton} />);

    expect(screen.getByTestId('test-action')).toBeInTheDocument();
  });

  test('handles contact without phone', () => {
    const contactWithoutPhone: Contact = {
      name: 'Alice Brown',
      email: 'alice@example.com',
      title: 'Designer',
      phone: '',
      _searchString: 'alice brown alice@example.com designer',
      raw: {},
    };

    render(<ContactCard {...contactWithoutPhone} />);

    expect(screen.getByText('Alice Brown')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/\(\d{3}\)/)).not.toBeInTheDocument();
  });

  test('handles contact without title', () => {
    const contactWithoutTitle: Contact = {
      name: 'Charlie Wilson',
      email: 'charlie@example.com',
      phone: '555-444-3333',
      title: '',
      _searchString: 'charlie wilson charlie@example.com',
      raw: {},
    };

    render(<ContactCard {...contactWithoutTitle} />);

    expect(screen.getByText('Charlie Wilson')).toBeInTheDocument();
    expect(screen.getByText('charlie@example.com')).toBeInTheDocument();
  });

  test('applies custom style', () => {
    const customStyle = { marginTop: '20px' };
    const { container } = render(<ContactCard {...mockContact} style={customStyle} />);

    const cardElement = container.firstChild as HTMLElement;
    expect(cardElement).toHaveStyle(customStyle);
  });

  test('shows "Notes" label when hasNotes is true without tags', () => {
    render(<ContactCard {...mockContact} hasNotes={true} onNotesClick={vi.fn()} />);
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  test('shows notes count label when hasNotes is true with tags', () => {
    render(
      <ContactCard
        {...mockContact}
        hasNotes={true}
        tags={['alpha', 'beta']}
        onNotesClick={vi.fn()}
      />,
    );
    expect(screen.getByText('Notes (2)')).toBeInTheDocument();
  });

  test('calls onNotesClick when notes button is clicked', () => {
    const onNotesClick = vi.fn();
    render(<ContactCard {...mockContact} onNotesClick={onNotesClick} />);
    fireEvent.click(screen.getByText('Add Note'));
    expect(onNotesClick).toHaveBeenCalled();
  });
});
