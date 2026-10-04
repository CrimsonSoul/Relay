import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Contact } from '@shared/ipc';
import { DeleteConfirmationModal } from '../DeleteConfirmationModal';

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  name: 'Ada Lovelace',
  email: 'ada.lovelace@example.com',
  phone: '',
  title: '',
  _searchString: 'ada lovelace',
  raw: {},
  ...overrides,
});

describe('DeleteConfirmationModal', () => {
  it('names the action and shows the email as a secondary identifier', () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmationModal contact={makeContact()} onClose={vi.fn()} onConfirm={onConfirm} />,
    );

    expect(screen.getByRole('dialog', { name: 'Delete contact' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada.lovelace@example.com')).toBeInTheDocument();
    expect(screen.getByText('You can undo this from the notice that follows.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Contact' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not repeat the email when the contact has no name', () => {
    render(
      <DeleteConfirmationModal
        contact={makeContact({ name: '' })}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getAllByText('ada.lovelace@example.com')).toHaveLength(1);
  });

  it('renders nothing without a contact', () => {
    render(<DeleteConfirmationModal contact={null} onClose={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
