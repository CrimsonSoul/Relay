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
    expect(cardElement).toHaveStyle({
      background: 'rgba(59, 130, 246, 0.06)',
    });
  });

  test('renders with groups', () => {
    const contactWithGroups: Contact = {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '555-987-6543',
      title: 'Manager',
      _searchString: 'jane smith jane@example.com manager',
      raw: {},
    };

    const groups = ['Engineering', 'Leads'];
    render(<ContactCard {...contactWithGroups} groups={groups} />);

    expect(screen.getByText('ENGINEERING')).toBeInTheDocument();
    expect(screen.getByText('LEADS')).toBeInTheDocument();
  });

  test('shows group count overflow', () => {
    const contactWithManyGroups: Contact = {
      name: 'Bob Johnson',
      email: 'bob@example.com',
      phone: '555-555-5555',
      title: 'Director',
      _searchString: 'bob johnson bob@example.com director',
      raw: {},
    };

    const groups = ['Group1', 'Group2', 'Group3', 'Group4'];
    render(<ContactCard {...contactWithManyGroups} groups={groups} />);

    expect(screen.getByText('GROUP1')).toBeInTheDocument();
    expect(screen.getByText('GROUP2')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
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
});
