import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabFallback } from '../TabFallback';

describe('TabFallback', () => {
  it('renders spinner when error is false', () => {
    const { container } = render(<TabFallback error={false} />);
    expect(container.querySelector('.tab-fallback-spinner')).toBeInTheDocument();
  });

  it('renders spinner when no prop passed', () => {
    const { container } = render(<TabFallback />);
    expect(container.querySelector('.tab-fallback-spinner')).toBeInTheDocument();
  });

  it('announces the failure as an alert with a decorative glyph', () => {
    render(<TabFallback error={true} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('panel-error', 'ink-rail', 'ink-rail--alarm');
    expect(alert).toHaveTextContent('This tab failed to load');
    expect(alert.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(alert).not.toHaveTextContent('⚠');
  });

  it('renders hint text when error is true', () => {
    render(<TabFallback error={true} />);
    expect(screen.getByText(/Try again first/)).toBeInTheDocument();
  });

  it('makes Try Again primary and Reload Application secondary when resettable', () => {
    const onReset = vi.fn();
    render(<TabFallback error={true} onReset={onReset} />);
    const tryAgain = screen.getByRole('button', { name: 'Try Again' });
    expect(tryAgain).toHaveClass('tactile-button--primary');
    expect(screen.getByRole('button', { name: 'Reload Application' })).toHaveClass(
      'tactile-button--secondary',
    );
    fireEvent.click(tryAgain);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('falls back to Reload Application as the only primary action without onReset', () => {
    render(<TabFallback error={true} />);
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Application' })).toHaveClass(
      'tactile-button--primary',
    );
  });
});
