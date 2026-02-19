import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TactileButton } from '../TactileButton';

describe('TactileButton', () => {
  it('renders children text', () => {
    render(<TactileButton>Click Me</TactileButton>);
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('shows loading spinner and disables button', () => {
    const { container } = render(<TactileButton loading>Btn</TactileButton>);
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.className).toContain('is-loading');
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('is disabled when disabled prop is true', () => {
    const { container } = render(<TactileButton disabled>Btn</TactileButton>);
    expect(container.querySelector('button')?.disabled).toBe(true);
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<TactileButton onClick={onClick}>Btn</TactileButton>);
    fireEvent.click(screen.getByText('Btn'));
    expect(onClick).toHaveBeenCalled();
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <TactileButton onClick={onClick} disabled>
        Btn
      </TactileButton>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders icon', () => {
    render(<TactileButton icon={<span data-testid="icon">★</span>}>With Icon</TactileButton>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('With Icon')).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<TactileButton>Btn</TactileButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('allows type="submit"', () => {
    render(<TactileButton type="submit">Submit</TactileButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('applies custom style', () => {
    const { container } = render(<TactileButton style={{ marginTop: '10px' }}>Btn</TactileButton>);
    const button = container.querySelector('button');
    expect(button?.style.marginTop).toBe('10px');
  });
});
