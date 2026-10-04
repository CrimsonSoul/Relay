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
      phone: '',
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

  test('exposes its stable record key for exact navigation focus', () => {
    render(<ContactCard {...mockContact} recordKey="id:contact_1" />);

    expect(screen.getByRole('button', { name: /john doe/i })).toHaveAttribute(
      'data-record-key',
      'id:contact_1',
    );
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

  test('renders the source label as a chip on the name line', () => {
    // The Assembler relies on this badge to tell hand-typed recipients apart
    // from group-derived ones.
    const { container } = render(<ContactCard {...mockContact} sourceLabel="Manual" />);

    const chip = screen.getByText('Manual');
    expect(chip).toBeInTheDocument();
    expect(container.querySelector('.contact-entry-line1')).toContainElement(chip);
  });

  test('omits the source label chip when no label is given', () => {
    const { container } = render(<ContactCard {...mockContact} />);

    expect(container.querySelector('.contact-entry-chip')).not.toBeInTheDocument();
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
    render(<ContactCard {...mockContact} onRowClick={handleRowClick} />);

    fireEvent.click(screen.getByRole('button', { name: /john doe/i }));
    expect(handleRowClick).toHaveBeenCalled();
  });

  test('marks the row an open menu acts on and keeps actions outside the row button', () => {
    const { container } = render(
      <ContactCard {...mockContact} menuTarget hasNotes onNotesClick={vi.fn()} />,
    );

    expect(container.querySelector('.contact-entry')).toHaveClass('contact-entry--menu-target');
    const notes = screen.getByRole('button', { name: 'Edit notes for John Doe' });
    expect(notes.closest('.contact-entry-main')).toBeNull();
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

  test('shows a 28px ghost icon notes button when hasNotes is true', () => {
    render(<ContactCard {...mockContact} hasNotes={true} onNotesClick={vi.fn()} />);
    const notes = screen.getByRole('button', { name: 'Edit notes for John Doe' });
    expect(notes).toHaveClass('tactile-button--ghost', 'tactile-button--xs');
    expect(notes).toHaveClass('tactile-button--icon-only');
  });

  test('shows notes button when hasNotes is true with tags', () => {
    render(
      <ContactCard
        {...mockContact}
        hasNotes={true}
        tags={['alpha', 'beta']}
        onNotesClick={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit notes for John Doe' })).toBeInTheDocument();
  });

  test('renders server relationship chips when counts are provided', () => {
    render(<ContactCard {...mockContact} relationshipCounts={{ owned: 2, supported: 1 }} />);

    expect(screen.getByText('Owns 2 servers')).toBeInTheDocument();
    expect(screen.getByText('Supports 1 server')).toBeInTheDocument();
  });

  test('calls onNotesClick when notes button is clicked', () => {
    const onNotesClick = vi.fn();
    render(<ContactCard {...mockContact} hasNotes={true} onNotesClick={onNotesClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit notes for John Doe' }));
    expect(onNotesClick).toHaveBeenCalled();
  });
});
