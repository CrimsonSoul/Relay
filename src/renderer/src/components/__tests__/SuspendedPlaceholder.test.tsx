import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SuspendedPlaceholder } from '../SuspendedPlaceholder';

describe('SuspendedPlaceholder', () => {
  it('renders the service name', () => {
    render(<SuspendedPlaceholder service="Gemini" onWakeUp={vi.fn()} />);
    expect(screen.getByText(/Gemini is sleeping/)).toBeInTheDocument();
  });

  it('renders wake up button', () => {
    render(<SuspendedPlaceholder service="ChatGPT" onWakeUp={vi.fn()} />);
    expect(screen.getByText('WAKE UP')).toBeInTheDocument();
  });

  it('calls onWakeUp when button clicked', () => {
    const onWakeUp = vi.fn();
    render(<SuspendedPlaceholder service="Gemini" onWakeUp={onWakeUp} />);
    fireEvent.click(screen.getByText('WAKE UP'));
    expect(onWakeUp).toHaveBeenCalled();
  });
});
