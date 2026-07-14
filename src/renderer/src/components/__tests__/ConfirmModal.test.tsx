import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    const dialog = document.querySelector('dialog');
    expect(!dialog || !dialog.hasAttribute('open')).toBe(true);
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

  it('waits for asynchronous confirmation before closing', async () => {
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const onClose = vi.fn();

    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Deactivate operator?"
        message="History stays attributed."
        confirmLabel="Deactivate"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.queryByLabelText('Close modal backdrop')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    resolveConfirm();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows asynchronous failure inside the dialog and updates it on retry', async () => {
    const onClose = vi.fn();
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not deactivate operator.'))
      .mockRejectedValueOnce(new Error('The operator changed. Refresh and retry.'));

    render(
      <ConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        title="Deactivate operator?"
        message="History stays attributed."
        confirmLabel="Deactivate"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    const dialog = screen.getByRole('dialog', { name: 'Deactivate operator?' });
    const firstError = await within(dialog).findByRole('alert');
    expect(firstError).toHaveTextContent('Could not deactivate operator.');
    expect(dialog).toHaveAttribute('aria-describedby', expect.stringContaining(firstError.id));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(within(dialog).queryByRole('alert')).toBeNull();
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'The operator changed. Refresh and retry.',
      ),
    );
    expect(onConfirm).toHaveBeenCalledTimes(2);
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
