import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OnCallDisplayControl } from './OnCallDisplayControl';

it('disables the Text Size command when the board is empty and restores it when enabled', () => {
  const onChange = vi.fn();
  const { rerender } = render(<OnCallDisplayControl value={100} onChange={onChange} disabled />);
  const display = screen.getByRole('button', { name: 'Text Size 100%' });
  expect(display).toBeDisabled();
  fireEvent.click(display);
  expect(screen.queryByRole('dialog', { name: 'Text size' })).not.toBeInTheDocument();

  rerender(<OnCallDisplayControl value={100} onChange={onChange} />);
  expect(display).toBeEnabled();
  fireEvent.click(display);
  const group = screen.getByRole('group', { name: 'Board text size' });
  expect(group).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
  expect(onChange).toHaveBeenCalledWith(105);
});

it('opens the font scale in a popover that keeps keyboard access', () => {
  render(<OnCallDisplayControl value={125} onChange={vi.fn()} />);
  const display = screen.getByRole('button', { name: 'Text Size 125%' });
  expect(display).toHaveAttribute('aria-haspopup', 'dialog');
  expect(display).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(display);
  const popover = screen.getByRole('dialog', { name: 'Text size' });
  expect(display).toHaveAttribute('aria-expanded', 'true');
  expect(display).toHaveAttribute('aria-controls', popover.id);
  expect(screen.getByRole('slider', { name: 'Text size' })).toHaveFocus();

  fireEvent.keyDown(popover, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Text size' })).not.toBeInTheDocument();
  expect(display).toHaveFocus();

  fireEvent.click(display);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog', { name: 'Text size' })).not.toBeInTheDocument();
});

it('offers Fit to Screen beside the manual scale only when the scale can change', () => {
  const onFitToScreen = vi.fn();
  const { rerender } = render(
    <OnCallDisplayControl value={100} onChange={vi.fn()} onFitToScreen={onFitToScreen} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Text Size 100%' }));
  const popover = screen.getByRole('dialog', { name: 'Text size' });
  expect(screen.getByRole('slider', { name: 'Text size' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fit to Screen' }));
  expect(onFitToScreen).toHaveBeenCalledOnce();
  expect(popover).toBeInTheDocument();

  rerender(<OnCallDisplayControl value={100} />);
  expect(screen.queryByRole('button', { name: 'Fit to Screen' })).not.toBeInTheDocument();
});
