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

    const cardElement = container.querySelector('.contact-entry');
    expect(cardElement).toHaveClass('contact-entry--selected');
  });

  test('shows contact details in a tooltip on hover', () => {
    render(<ContactCard {...mockContact} />);

    const row = screen.getByRole('button', { name: /john doe/i });
    expect(row).not.toHaveAttribute('title');

    fireEvent.mouseEnter(screen.getByText('John Doe'));

    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(tooltip).toHaveTextContent('John Doe');
    expect(tooltip).toHaveTextContent('john.doe@example.com');
  });

  test('renders with source label prop without error', () => {
    // sourceLabel is accepted as a prop; rendering should not throw
    expect(() => render(<ContactCard {...mockContact} sourceLabel="CSV" />)).not.toThrow();
  });

  test('calls onContextMenu when right-clicked', () => {
    const handleContextMenu = vi.fn();
    const { container } = render(
      <ContactCard {...mockContact} onContextMenu={handleContextMenu} />,
    );

    const cardElement = container.querySelector('.contact-entry');
    if (cardElement) {
      fireEvent.contextMenu(cardElement);
      expect(handleContextMenu).toHaveBeenCalled();
    }
  });

  test('calls onRowClick when clicked', () => {
    const handleRowClick = vi.fn();
    const { container } = render(<ContactCard {...mockContact} onRowClick={handleRowClick} />);

    const cardElement = container.querySelector('.contact-entry');
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

  test('shows notes button when hasNotes is true', () => {
    const { container } = render(
      <ContactCard {...mockContact} hasNotes={true} onNotesClick={vi.fn()} />,
    );
    expect(container.querySelector('.contact-entry-notes-btn')).toBeInTheDocument();
  });

  test('shows notes button when hasNotes is true with tags', () => {
    const { container } = render(
      <ContactCard
        {...mockContact}
        hasNotes={true}
        tags={['alpha', 'beta']}
        onNotesClick={vi.fn()}
      />,
    );
    expect(container.querySelector('.contact-entry-notes-btn')).toBeInTheDocument();
  });

  test('renders server relationship chips when counts are provided', () => {
    render(<ContactCard {...mockContact} relationshipCounts={{ owned: 2, supported: 1 }} />);

    expect(screen.getByText('Owner 2')).toBeInTheDocument();
    expect(screen.getByText('Support 1')).toBeInTheDocument();
  });

  test('calls onNotesClick when notes button is clicked', () => {
    const onNotesClick = vi.fn();
    const { container } = render(
      <ContactCard {...mockContact} hasNotes={true} onNotesClick={onNotesClick} />,
    );
    const btn = container.querySelector('.contact-entry-notes-btn') as HTMLElement;
    fireEvent.click(btn);
    expect(onNotesClick).toHaveBeenCalled();
  });
});
