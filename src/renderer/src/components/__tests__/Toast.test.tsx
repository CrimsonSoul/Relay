import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider, NoopToastProvider, useToast } from '../Toast';

// A helper component that triggers toasts
const ToastTrigger: React.FC<{
  message?: string;
  type?: 'success' | 'error' | 'info';
}> = ({ message = 'Test toast', type = 'success' }) => {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast(message, type)} data-testid="trigger">
      Show Toast
    </button>
  );
};

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(
      <ToastProvider>
        <div data-testid="child">Hello</div>
      </ToastProvider>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows a success toast when showToast is called with success type', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Saved!" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('shows an error toast when showToast is called with error type', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Something went wrong" type="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('shows an info toast with Notice title', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Notice this" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Notice this')).toBeInTheDocument();
    expect(screen.getByText('Notice')).toBeInTheDocument();
  });

  it('shows multiple toasts', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="First" type="success" />
      </ToastProvider>,
    );
    const trigger = screen.getByTestId('trigger');
    fireEvent.click(trigger);
    // Show a second toast by clicking again (message same but creates new toast)
    fireEvent.click(trigger);
    const toasts = screen.getAllByText('First');
    expect(toasts.length).toBe(2);
  });

  it('auto-removes toast after 4 seconds', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Temporary" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4001);
    });

    expect(screen.queryByText('Temporary')).toBeNull();
  });

  it('removes toast when dismiss button is clicked', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Dismissable" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Dismissable')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.queryByText('Dismissable')).toBeNull();
  });

  it('uses role=alert for error toasts', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Error!" type="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the toast container with aria-label', () => {
    render(
      <ToastProvider>
        <div />
      </ToastProvider>,
    );
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });
});

describe('useToast', () => {
  it('throws when used outside of ToastProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ThrowingComponent = () => {
      useToast();
      return null;
    };
    expect(() => render(<ThrowingComponent />)).toThrow(
      'useToast must be used within a ToastProvider',
    );
    consoleError.mockRestore();
  });
});

describe('NoopToastProvider', () => {
  it('renders children without showing real toasts', () => {
    render(
      <NoopToastProvider>
        <ToastTrigger message="Noop" type="success" />
      </NoopToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    // NoopToastProvider doesn't show toast UI
    expect(screen.queryByText('Success')).toBeNull();
  });

  it('showToast in noop provider does nothing', () => {
    // Just confirm no error thrown
    render(
      <NoopToastProvider>
        <ToastTrigger message="Quiet" type="error" />
      </NoopToastProvider>,
    );
    expect(() => fireEvent.click(screen.getByTestId('trigger'))).not.toThrow();
  });
});
