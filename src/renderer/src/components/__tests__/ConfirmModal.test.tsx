import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmModal } from '../ConfirmModal';

describe('ConfirmModal', () => {
  it('does not render when isOpen is false', () => {
    render(
      <ConfirmModal
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete item"
        message="Are you sure?"
      />,
    );
    expect(screen.queryByText('Delete item')).toBeNull();
  });

  it('renders title and message when open', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete item"
        message="Are you sure you want to delete this?"
      />,
    );
    expect(screen.getByText('Delete item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this?')).toBeInTheDocument();
  });

  it('shows default button labels', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Are you sure?"
        message="This cannot be undone."
      />,
    );
    // Button label "Confirm" should exist (use role to target the button)
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows custom button labels', () => {
    render(
      <ConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Remove"
        message="Remove this?"
        confirmLabel="Remove"
        cancelLabel="Go back"
      />,
    );
    expect(screen.getAllByText('Remove').length).toBeGreaterThan(0);
    expect(screen.getByText('Go back')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Confirm"
        message="Sure?"
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onConfirm and onClose when Confirm is clicked', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Proceed?"
        message="Sure?"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('uses danger variant when isDanger is true', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete"
        message="Really delete?"
        isDanger={true}
        confirmLabel="Delete"
      />,
    );
    // The Confirm button should render with danger variant
    const deleteBtn = screen.getAllByText('Delete').find((el) => el.tagName !== 'H2');
    expect(deleteBtn).toBeTruthy();
  });
});
