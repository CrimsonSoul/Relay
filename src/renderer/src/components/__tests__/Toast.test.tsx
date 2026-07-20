import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider, NoopToastProvider, useToast } from '../Toast';

// A helper component that triggers toasts
const ToastTrigger: React.FC<{
  message?: string;
  type?: 'success' | 'error' | 'info' | 'warning';
}> = ({ message = 'Test toast', type = 'success' }) => {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast(message, type)} data-testid="trigger">
      Show Toast
    </button>
  );
};

const ActionToastTrigger: React.FC<{ onAction: () => void }> = ({ onAction }) => {
  const { showToast } = useToast();
  return (
    <button
      onClick={() =>
        showToast('New problem', 'error', {
          title: 'New Dynatrace problem',
          durationMs: 8_000,
          action: { label: 'Open Problems', onClick: onAction },
        })
      }
    >
      Show action toast
    </button>
  );
};

const OperationalToastTrigger: React.FC<{ onAction?: () => void }> = ({ onAction = () => {} }) => {
  const { showToast } = useToast();
  return (
    <>
      <button
        onClick={() =>
          showToast('AWS outage', 'error', {
            title: 'Cloud outage',
            durationMs: 4_000,
            delivery: 'cloud-outage',
          })
        }
      >
        Cloud
      </button>
      <button
        onClick={() =>
          showToast('Dynatrace one', 'error', {
            title: 'New Dynatrace problem',
            durationMs: 8_000,
            delivery: 'dynatrace-problem',
          })
        }
      >
        Dynatrace one
      </button>
      <button
        onClick={() =>
          showToast('Dynatrace two', 'warning', {
            title: 'New Dynatrace problem',
            durationMs: 8_000,
            delivery: 'dynatrace-problem',
          })
        }
      >
        Dynatrace two
      </button>
      <button
        onClick={() =>
          showToast('Dynatrace action', 'error', {
            title: 'New Dynatrace problem',
            durationMs: 8_000,
            delivery: 'dynatrace-problem',
            action: { label: 'Open Problems', onClick: onAction },
          })
        }
      >
        Dynatrace action
      </button>
      <button onClick={() => showToast('Contact saved', 'success')}>Routine</button>
    </>
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

  it('shows a warning toast with Warning title as polite output', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Watch this" type="warning" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Watch this')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Watch this').closest('output')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  it('queues cloud outages until the active Dynatrace problem closes', async () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));

    expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeInTheDocument();
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(8_160));
    expect(screen.getByText('AWS outage')).toBeInTheDocument();
  });

  it('preempts a visible cloud outage and restarts its full duration after Dynatrace', async () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    await act(async () => vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));

    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();
    expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(8_160));
    expect(screen.getByText('AWS outage')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(3_999));
    expect(screen.getByText('AWS outage')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(161));
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();
  });

  it('does not let the interrupted cloud timer remove a queued outage', async () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    await act(async () => vi.advanceTimersByTime(3_999));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(8_160));
    expect(screen.getByText('AWS outage')).toBeInTheDocument();
  });

  it('keeps Dynatrace FIFO ahead of queued cloud outages', async () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace two' }));

    expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeInTheDocument();
    expect(
      screen.queryByText('Dynatrace two', { selector: '.toast-message' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(8_160));
    expect(screen.getByText('Dynatrace two', { selector: '.toast-message' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(8_160));
    expect(screen.getByText('AWS outage')).toBeInTheDocument();
  });

  it('renders routine toasts below the active operational toast', () => {
    const { container } = render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Routine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));

    expect(
      Array.from(container.querySelectorAll('.toast-message')).map((node) => node.textContent),
    ).toEqual(['Dynatrace one', 'Contact saved']);
  });

  it('advances the operational queue after an action and manual dismissal', async () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <OperationalToastTrigger onAction={onAction} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace action' }));
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Problems' }));
    await act(async () => vi.advanceTimersByTime(160));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getByText('AWS outage')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    await act(async () => vi.advanceTimersByTime(160));
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();
  });

  it('auto-removes toast after 4 seconds', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Temporary" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(4000));

    expect(screen.getByText('Temporary').closest('.toast')).toHaveAttribute(
      'data-state',
      'closing',
    );
    await act(async () => vi.advanceTimersByTime(159));
    expect(screen.getByText('Temporary')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));

    expect(screen.queryByText('Temporary')).toBeNull();
  });

  it('removes toast when dismiss button is clicked', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Dismissable" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Dismissable')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.getByText('Dismissable').closest('.toast')).toHaveAttribute(
      'data-state',
      'closing',
    );
    await act(async () => vi.advanceTimersByTime(160));
    expect(screen.queryByText('Dismissable')).toBeNull();
  });

  it('keeps a dismissed toast mounted in closing state for its exit', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Saved" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.getByText('Saved').closest('.toast')).toHaveAttribute('data-state', 'closing');
    await act(async () => vi.advanceTimersByTime(159));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('supports a custom title, duration, and dismissing action', async () => {
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <ActionToastTrigger onAction={onAction} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show action toast' }));

    expect(screen.getByText('New Dynatrace problem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Problems' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getByText('New problem').closest('.toast')).toHaveAttribute(
      'data-state',
      'closing',
    );

    await act(async () => vi.advanceTimersByTime(160));
    expect(screen.queryByText('New problem')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(8_001);
    });
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
