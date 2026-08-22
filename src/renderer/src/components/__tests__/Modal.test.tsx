import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Modal } from '../Modal';

// Mock Tooltip
vi.mock('../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

describe('Modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => globalThis.clearTimeout(id));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.classList.remove('modal-open');
  });

  function ModalHarness({ dismissible = true }: Readonly<{ dismissible?: boolean }>) {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open layer
        </button>
        <Modal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Layer title"
          subtitle="Useful context"
          variant="confirmation"
          dismissible={dismissible}
          footer={<button type="button">Confirm</button>}
        >
          <button type="button">Inside layer</button>
        </Modal>
      </>
    );
  }

  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('renders children when open', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Modal Content</p>
      </Modal>,
    );
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Title">
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('has role=dialog and aria-modal', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );

    fireEvent.click(screen.getByLabelText('Close modal backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when dialog content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );

    fireEvent.click(screen.getByText('Content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when pointerdown happens inside dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when mousedown happens inside dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('prevents body scroll when open', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(document.body.classList.contains('modal-open')).toBe(true);
  });

  it('restores body scroll when closed', () => {
    const { unmount } = render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );

    expect(document.body.classList.contains('modal-open')).toBe(true);
    unmount();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('renders close button with aria-label', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose}>
        <p>Content</p>
      </Modal>,
    );

    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('removes close affordances and blocks Escape when dismissal is disabled', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} dismissible={false} title="Working">
        <p>Pending content</p>
      </Modal>,
    );

    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.queryByLabelText('Close modal backdrop')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('applies custom width', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} width="800px">
        <p>Content</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.width).toBe('800px');
  });

  it('keeps the portal mounted in closing state for the 160ms exit', async () => {
    const { rerender } = render(
      <Modal isOpen onClose={vi.fn()} title="Lifecycle">
        Body
      </Modal>,
    );
    rerender(
      <Modal isOpen={false} onClose={vi.fn()} title="Lifecycle">
        Body
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-state', 'closing');
    await act(async () => vi.advanceTimersByTime(159));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes the confirmation variant and shared anatomy', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open layer' }));
    const dialog = screen.getByRole('dialog', { name: 'Layer title' });
    expect(dialog).toHaveAttribute('data-variant', 'confirmation');
    expect(dialog.querySelector('.modal-header-generic')).not.toBeNull();
    expect(dialog.querySelector('.modal-subtitle-generic')).toHaveTextContent('Useful context');
    expect(dialog.querySelector('.modal-footer-generic')).not.toBeNull();
    expect(dialog.querySelector('.modal-accent-line')).toBeNull();
  });

  it('restores trigger focus only after the closing portal unmounts', async () => {
    render(<ModalHarness />);
    const trigger = screen.getByRole('button', { name: 'Open layer' });
    trigger.focus();
    fireEvent.click(trigger);
    await act(async () => vi.advanceTimersByTime(16));
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
    await act(async () => vi.advanceTimersByTime(160));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('keeps body scroll locked while any nested modal remains mounted', () => {
    const { rerender } = render(
      <>
        <Modal isOpen onClose={vi.fn()} title="Outer">
          Outer body
        </Modal>
        <Modal isOpen onClose={vi.fn()} title="Inner">
          Inner body
        </Modal>
      </>,
    );
    expect(document.body).toHaveClass('modal-open');
    rerender(
      <>
        <Modal isOpen onClose={vi.fn()} title="Outer">
          Outer body
        </Modal>
        <Modal isOpen={false} onClose={vi.fn()} title="Inner">
          Inner body
        </Modal>
      </>,
    );
    expect(document.body).toHaveClass('modal-open');
  });

  it('lets only the top nested modal handle Escape', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <>
        <Modal isOpen onClose={outerClose} title="Outer">
          Outer body
        </Modal>
        <Modal isOpen onClose={innerClose} title="Inner">
          Inner body
        </Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
  });
});
