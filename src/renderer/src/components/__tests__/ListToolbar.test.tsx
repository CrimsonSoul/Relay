import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListToolbar } from '../ListToolbar';

const defaultProps = {
  search: '',
  onSearchChange: vi.fn(),
  sortDirection: 'asc' as const,
  onToggleSortDirection: vi.fn(),
};

describe('ListToolbar', () => {
  it('renders search input with default placeholder', () => {
    render(<ListToolbar {...defaultProps} />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders search input with custom placeholder', () => {
    render(<ListToolbar {...defaultProps} placeholder="Find contact..." />);
    expect(screen.getByPlaceholderText('Find contact...')).toBeInTheDocument();
  });

  it('calls onSearchChange when search input changes', () => {
    const onSearchChange = vi.fn();
    render(<ListToolbar {...defaultProps} onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), {
      target: { value: 'hello' },
    });
    expect(onSearchChange).toHaveBeenCalledWith('hello');
  });

  it('renders sort direction button', () => {
    const onToggleSortDirection = vi.fn();
    render(<ListToolbar {...defaultProps} onToggleSortDirection={onToggleSortDirection} />);
    // The sort button has title "Ascending"
    const btn = screen.getByTitle('Ascending');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onToggleSortDirection).toHaveBeenCalled();
  });

  it('shows sort options dropdown when provided', () => {
    const sortOptions = [
      { value: 'name', label: 'Name' },
      { value: 'email', label: 'Email' },
    ];
    render(
      <ListToolbar
        {...defaultProps}
        sortKey="name"
        sortOptions={sortOptions}
        onSortKeyChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Sort By')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls onSortKeyChange when sort dropdown changes', () => {
    const onSortKeyChange = vi.fn();
    const sortOptions = [
      { value: 'name', label: 'Name' },
      { value: 'email', label: 'Email' },
    ];
    render(
      <ListToolbar
        {...defaultProps}
        sortKey="name"
        sortOptions={sortOptions}
        onSortKeyChange={onSortKeyChange}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'email' } });
    expect(onSortKeyChange).toHaveBeenCalledWith('email');
  });

  it('renders children', () => {
    render(
      <ListToolbar {...defaultProps}>
        <button>Extra Action</button>
      </ListToolbar>,
    );
    expect(screen.getByText('Extra Action')).toBeInTheDocument();
  });
});
