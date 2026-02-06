import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SaveGroupModal } from '../SaveGroupModal';

// Mock Modal to avoid portal issues in jsdom
vi.mock('../../../components/Modal', () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? React.createElement('div', { 'data-testid': 'modal' }, children) : null,
}));

describe('SaveGroupModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    existingNames: ['Existing Group'],
  };

  it('renders with default title and description', () => {
    render(<SaveGroupModal {...defaultProps} />);
    expect(screen.getByText('Save Group')).toBeInTheDocument();
    expect(screen.getByText('Save the current selection as a reusable group.')).toBeInTheDocument();
  });

  it('renders with custom title and description', () => {
    render(
      <SaveGroupModal
        {...defaultProps}
        title="Save as Group"
        description="Save 5 recipients from this bridge."
      />,
    );
    expect(screen.getByText('Save as Group')).toBeInTheDocument();
    expect(screen.getByText('Save 5 recipients from this bridge.')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<SaveGroupModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Save Group')).not.toBeInTheDocument();
  });

  it('shows error for empty name', () => {
    render(<SaveGroupModal {...defaultProps} />);

    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText('Please enter a name')).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('shows error for duplicate name (case insensitive)', () => {
    render(<SaveGroupModal {...defaultProps} />);

    const input = screen.getByPlaceholderText('e.g., Network P1, Database Team');
    fireEvent.change(input, { target: { value: 'existing group' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText('A group with this name already exists')).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with trimmed name on valid submission', () => {
    const onSave = vi.fn();
    render(<SaveGroupModal {...defaultProps} onSave={onSave} />);

    const input = screen.getByPlaceholderText('e.g., Network P1, Database Team');
    fireEvent.change(input, { target: { value: '  New Group  ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('New Group');
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<SaveGroupModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits on Enter key', () => {
    const onSave = vi.fn();
    render(<SaveGroupModal {...defaultProps} onSave={onSave} />);

    const input = screen.getByPlaceholderText('e.g., Network P1, Database Team');
    fireEvent.change(input, { target: { value: 'Quick Group' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith('Quick Group');
  });

  it('clears error when user types', () => {
    render(<SaveGroupModal {...defaultProps} />);

    // Trigger error
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText('Please enter a name')).toBeInTheDocument();

    // Type to clear error
    const input = screen.getByPlaceholderText('e.g., Network P1, Database Team');
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.queryByText('Please enter a name')).not.toBeInTheDocument();
  });

  it('populates initial name when provided', () => {
    render(<SaveGroupModal {...defaultProps} initialName="Prefilled" />);

    const input = screen.getByDisplayValue('Prefilled');
    expect(input).toBeInTheDocument();
  });

  // Contact preview list tests
  it('does not show contacts list when contacts prop is omitted', () => {
    render(<SaveGroupModal {...defaultProps} />);
    expect(screen.queryByText(/recipients/)).not.toBeInTheDocument();
  });

  it('does not show contacts list when contacts array is empty', () => {
    render(<SaveGroupModal {...defaultProps} contacts={[]} />);
    expect(screen.queryByText(/recipients/)).not.toBeInTheDocument();
  });

  it('shows contacts preview list with correct count', () => {
    const contacts = ['alice@test.com', 'bob@test.com', 'charlie@test.com'];
    render(<SaveGroupModal {...defaultProps} contacts={contacts} />);

    expect(screen.getByText('3 recipients')).toBeInTheDocument();
    expect(screen.getByText('alice@test.com')).toBeInTheDocument();
    expect(screen.getByText('bob@test.com')).toBeInTheDocument();
    expect(screen.getByText('charlie@test.com')).toBeInTheDocument();
  });

  it('shows singular "recipient" for single contact', () => {
    render(<SaveGroupModal {...defaultProps} contacts={['solo@test.com']} />);
    expect(screen.getByText('1 recipient')).toBeInTheDocument();
  });

  it('shows error for whitespace-only name', () => {
    render(<SaveGroupModal {...defaultProps} />);

    const input = screen.getByPlaceholderText('e.g., Network P1, Database Team');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText('Please enter a name')).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });
});
