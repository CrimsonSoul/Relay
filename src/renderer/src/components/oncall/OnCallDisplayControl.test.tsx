import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OnCallDisplayControl } from './OnCallDisplayControl';

it('disables the font control group when the board is empty and restores its controls when enabled', () => {
  const onChange = vi.fn();
  const { rerender } = render(<OnCallDisplayControl value={100} onChange={onChange} disabled />);
  expect(screen.getByRole('group', { name: 'On-call board font scale' })).toBeDisabled();
  expect(screen.getByRole('slider')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Increase board font size' }));
  expect(onChange).not.toHaveBeenCalled();

  rerender(<OnCallDisplayControl value={100} onChange={onChange} />);
  expect(screen.getByRole('group', { name: 'On-call board font scale' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Increase board font size' }));
  expect(onChange).toHaveBeenCalledWith(105);
});
