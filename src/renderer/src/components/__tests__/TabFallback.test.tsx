import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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

  it('renders error message when error is true', () => {
    render(<TabFallback error={true} />);
    expect(screen.getByText('This tab failed to load')).toBeInTheDocument();
  });

  it('renders hint text when error is true', () => {
    render(<TabFallback error={true} />);
    expect(screen.getByText(/Try reloading/)).toBeInTheDocument();
  });

  it('renders Reload Tab button when error is true', () => {
    render(<TabFallback error={true} />);
    expect(screen.getByText('Reload Tab')).toBeInTheDocument();
  });
});
