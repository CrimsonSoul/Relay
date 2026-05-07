import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListToolbar } from '../ListToolbar';

const defaultProps = {
  sortDirection: 'asc' as const,
  onToggleSortDirection: vi.fn(),
};

describe('ListToolbar', () => {
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

  it('shows Descending title when sortDirection is desc', () => {
    render(<ListToolbar sortDirection="desc" onToggleSortDirection={vi.fn()} />);
    expect(screen.getByTitle('Descending')).toBeInTheDocument();
  });

  it('renders sort button without dropdown when no sortOptions provided', () => {
    render(<ListToolbar {...defaultProps} />);
    // Should render the simple sort direction button, not the dropdown
    expect(screen.queryByText('Sort By')).not.toBeInTheDocument();
    expect(screen.getByTitle('Ascending')).toBeInTheDocument();
  });

  it('renders sort button without dropdown when sortOptions is empty', () => {
    render(<ListToolbar {...defaultProps} sortOptions={[]} onSortKeyChange={vi.fn()} />);
    expect(screen.queryByText('Sort By')).not.toBeInTheDocument();
  });

  it('renders sort button without dropdown when onSortKeyChange is not provided', () => {
    const sortOptions = [{ value: 'name', label: 'Name' }];
    render(<ListToolbar {...defaultProps} sortOptions={sortOptions} />);
    // Even with sortOptions, without onSortKeyChange it falls back to simple button
    expect(screen.queryByText('Sort By')).not.toBeInTheDocument();
  });

  it('shows Descending title with sort options', () => {
    render(
      <ListToolbar
        sortDirection="desc"
        onToggleSortDirection={vi.fn()}
        sortKey="name"
        sortOptions={[{ value: 'name', label: 'Name' }]}
        onSortKeyChange={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Descending')).toBeInTheDocument();
  });

  it('disables sort controls when disabled', () => {
    const onToggleSortDirection = vi.fn();
    const onSortKeyChange = vi.fn();
    render(
      <ListToolbar
        sortDirection="asc"
        onToggleSortDirection={onToggleSortDirection}
        sortKey="name"
        sortOptions={[{ value: 'name', label: 'Name' }]}
        onSortKeyChange={onSortKeyChange}
        disabled
      />,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByTitle('Ascending')).toBeDisabled();
  });
});
