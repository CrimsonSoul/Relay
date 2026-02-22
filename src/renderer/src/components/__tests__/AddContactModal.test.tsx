import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AddContactModal } from '../AddContactModal';
import type { Contact } from '@shared/ipc';

// Mock Modal to avoid portal
vi.mock('../Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    isOpen
      ? React.createElement('div', { 'data-testid': 'modal' }, [
          title && React.createElement('h2', { key: 'title' }, title),
          children,
        ])
      : null,
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  loggers: {
    directory: { error: vi.fn() },
  },
}));

// Mock phoneUtils
vi.mock('@shared/phoneUtils', () => ({
  sanitizePhoneNumber: (phone: string) => phone.replaceAll(/\D/g, ''),
  formatPhoneNumber: (phone: string) => {
    const digits = phone.replaceAll(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  },
}));

describe('AddContactModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };

  it('renders in create mode with empty fields', () => {
    render(<AddContactModal {...defaultProps} />);
    expect(screen.getByText('Add Contact')).toBeInTheDocument();
    expect(screen.getByText('Create Contact')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<AddContactModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Add Contact')).not.toBeInTheDocument();
  });

  it('pre-fills email when initialEmail is provided', () => {
    render(<AddContactModal {...defaultProps} initialEmail="test@example.com" />);
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
  });

  it('renders in edit mode when editContact is provided', () => {
    const editContact: Contact = {
      name: 'Alice',
      email: 'alice@test.com',
      phone: '5551234567',
      title: 'Engineer',
      _searchString: '',
      raw: {},
    };

    render(<AddContactModal {...defaultProps} editContact={editContact} />);
    expect(screen.getByText('Edit Contact')).toBeInTheDocument();
    expect(screen.getByText('Update Contact')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alice@test.com')).toBeInTheDocument();
  });

  it('does not submit when name is empty', () => {
    const onSave = vi.fn();
    render(<AddContactModal {...defaultProps} onSave={onSave} />);

    // Fill only email
    fireEvent.change(screen.getByPlaceholderText('alice@example.com'), {
      target: { value: 'test@test.com' },
    });

    fireEvent.submit(screen.getByPlaceholderText('alice@example.com').closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not submit when email is empty', () => {
    const onSave = vi.fn();
    render(<AddContactModal {...defaultProps} onSave={onSave} />);

    // Fill only name
    fireEvent.change(screen.getByPlaceholderText('e.g. Alice Smith'), {
      target: { value: 'Alice' },
    });

    fireEvent.submit(screen.getByPlaceholderText('e.g. Alice Smith').closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('submits form with all fields and sanitized phone', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AddContactModal {...defaultProps} onSave={onSave} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. Alice Smith'), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByPlaceholderText('alice@example.com'), {
      target: { value: 'alice@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. Marketing Director'), {
      target: { value: 'Engineer' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. (555) 123-4567'), {
      target: { value: '(555) 123-4567' },
    });

    fireEvent.submit(screen.getByPlaceholderText('e.g. Alice Smith').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        name: 'Alice',
        email: 'alice@test.com',
        phone: '5551234567', // sanitized
        title: 'Engineer',
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('formats phone number on blur', () => {
    render(<AddContactModal {...defaultProps} />);

    const phoneInput = screen.getByPlaceholderText('e.g. (555) 123-4567');
    fireEvent.change(phoneInput, { target: { value: '5551234567' } });
    fireEvent.blur(phoneInput);

    expect(screen.getByDisplayValue('(555) 123-4567')).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<AddContactModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close modal on save failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('API Error'));
    const onClose = vi.fn();
    render(<AddContactModal {...defaultProps} onSave={onSave} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. Alice Smith'), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByPlaceholderText('alice@example.com'), {
      target: { value: 'alice@test.com' },
    });

    fireEvent.submit(screen.getByPlaceholderText('e.g. Alice Smith').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalled();
    });

    // onClose should NOT have been called since save failed
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables submit button while submitting', async () => {
    let resolvePromise: () => void;
    const savePromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const onSave = vi.fn().mockReturnValue(savePromise);

    render(<AddContactModal {...defaultProps} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText('e.g. Alice Smith'), {
      target: { value: 'Alice' },
    });
    fireEvent.change(screen.getByPlaceholderText('alice@example.com'), {
      target: { value: 'alice@test.com' },
    });

    fireEvent.submit(screen.getByPlaceholderText('e.g. Alice Smith').closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    // Resolve and check it re-enables
    resolvePromise!();
    await waitFor(() => {
      expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
    });
  });
});
