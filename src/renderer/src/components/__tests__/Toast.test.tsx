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

const UndoToastTrigger: React.FC<{ onUndo: () => void; onDismiss: () => void }> = ({
  onUndo,
  onDismiss,
}) => {
  const { showToast } = useToast();
  return (
    <button
      onClick={() =>
        showToast('Deleted Ada', 'info', {
          durationMs: 6_000,
          action: { label: 'Undo', onClick: onUndo },
          onDismiss,
        })
      }
    >
      Delete Ada
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
          showToast('Azure degradation', 'warning', {
            title: 'Cloud degradation',
            durationMs: 6_000,
            delivery: 'cloud-degradation',
          })
        }
      >
        Degradation
      </button>
      <button
        onClick={() =>
          showToast('Prod01 is red on Dispatcher Radar.', 'error', {
            title: 'Radar queue critical',
            durationMs: 8_000,
            delivery: 'radar-critical',
          })
        }
      >
        Radar
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
    vi.unstubAllGlobals();
  });

  it('renders children', () => {
    render(
      <ToastProvider>
        <div data-testid="child">Hello</div>
      </ToastProvider>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows a success toast whose message states the outcome without a generic title', () => {
    const { container } = render(
      <ToastProvider>
        <ToastTrigger message="Saved!" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(container.querySelector('.toast-title')).toBeNull();
    expect(screen.getByText('Success:')).toHaveClass('sr-only');
  });

  it('shows a toast when randomUUID is unavailable in a web client', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
    });
    render(
      <ToastProvider>
        <ToastTrigger message="Web toast" type="success" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByTestId('trigger'));

    expect(screen.getByText('Web toast')).toBeInTheDocument();
  });

  it('shows an error toast with its severity announced but no visible generic title', () => {
    const { container } = render(
      <ToastProvider>
        <ToastTrigger message="Something went wrong" type="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(container.querySelector('.toast-title')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Error: Something went wrong');
  });

  it('announces an info toast as a notice', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Notice this" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Notice this')).toBeInTheDocument();
    expect(screen.getByText('Notice:')).toHaveClass('sr-only');
  });

  it('appends a warning toast into the persistent polite stack, announced as a warning', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Watch this" type="warning" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByText('Watch this')).toBeInTheDocument();
    expect(screen.getByText('Warning:')).toHaveClass('sr-only');
    const stack = screen.getByRole('region', { name: 'Messages' });
    expect(stack).not.toHaveAttribute('aria-live');
    const polite = screen.getByText('Watch this').closest('[aria-live]');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(stack).toContainElement(polite as HTMLElement);
    expect(screen.getByText('Watch this').closest('output')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mounts the polite stack empty before any toast arrives', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Later" type="success" />
      </ToastProvider>,
    );
    const stack = screen.getByRole('region', { name: 'Messages' });
    const polite = stack.querySelector('[aria-live="polite"]');
    expect(polite).toBeEmptyDOMElement();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(stack.querySelector('[aria-live="polite"]')).toBe(polite);
    expect(polite).toHaveTextContent('Success: Later');
  });

  it('hides the dismiss glyph from assistive technology', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Glyph" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    const svg = screen.getByRole('button', { name: 'Dismiss: Glyph' }).querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('shows an explicit title when one is given', () => {
    render(
      <ToastProvider>
        <ActionToastTrigger onAction={vi.fn()} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show action toast' }));
    expect(screen.getByText('New Dynatrace problem')).toHaveClass('toast-title');
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
    expect(toasts).toHaveLength(2);
  });

  it('caps the routine stack during an error burst, keeping the newest', () => {
    const BurstTrigger: React.FC = () => {
      const { showToast } = useToast();
      return (
        <button
          data-testid="burst"
          onClick={() => {
            for (let index = 1; index <= 9; index += 1) showToast(`Sync failure ${index}`, 'error');
          }}
        >
          Burst
        </button>
      );
    };

    const { container } = render(
      <ToastProvider>
        <BurstTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('burst'));

    expect(
      Array.from(container.querySelectorAll('.toast-message')).map((node) => node.textContent),
    ).toEqual(['Sync failure 6', 'Sync failure 7', 'Sync failure 8', 'Sync failure 9']);
  });

  it('does not let a routine burst evict operational toasts', () => {
    const { container } = render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));
    const routine = screen.getByRole('button', { name: 'Routine' });
    for (let index = 0; index < 9; index += 1) fireEvent.click(routine);

    const messages = Array.from(container.querySelectorAll('.toast-message')).map(
      (node) => node.textContent,
    );
    expect(messages[0]).toBe('Dynatrace one');
    expect(messages).toHaveLength(5);
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

  it('preempts a visible degradation with an outage and resumes its full duration', async () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Degradation' }));
    await act(async () => vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));

    expect(screen.queryByText('Azure degradation')).not.toBeInTheDocument();
    expect(screen.getByText('AWS outage', { selector: '.toast-message' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(4_160));
    expect(
      screen.getByText('Azure degradation', { selector: '.toast-message' }),
    ).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(5_999));
    expect(screen.getByText('Azure degradation')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(161));
    expect(screen.queryByText('Azure degradation')).not.toBeInTheDocument();
  });

  it('orders Dynatrace, Radar, outage, then degradation regardless of arrival order', async () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Degradation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Radar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));

    expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeInTheDocument();
    expect(screen.queryByText('Prod01 is red on Dispatcher Radar.')).not.toBeInTheDocument();
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();
    expect(screen.queryByText('Azure degradation')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(8_160));
    expect(
      screen.getByText('Prod01 is red on Dispatcher Radar.', { selector: '.toast-message' }),
    ).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(8_160));
    expect(screen.getByText('AWS outage', { selector: '.toast-message' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(4_160));
    expect(
      screen.getByText('Azure degradation', { selector: '.toast-message' }),
    ).toBeInTheDocument();
  });

  it('lets Radar preempt cloud while remaining queued behind Dynatrace', () => {
    render(
      <ToastProvider>
        <OperationalToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cloud' }));
    fireEvent.click(screen.getByRole('button', { name: 'Radar' }));

    expect(
      screen.getByText('Prod01 is red on Dispatcher Radar.', { selector: '.toast-message' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('AWS outage')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dynatrace one' }));

    expect(screen.getByText('Dynatrace one', { selector: '.toast-message' })).toBeInTheDocument();
    expect(screen.queryByText('Prod01 is red on Dispatcher Radar.')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: AWS outage' }));
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
    fireEvent.click(screen.getByLabelText('Dismiss: Dismissable'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Saved' }));

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
    const alert = screen.getByRole('alert');
    // Outside the polite stack, so the error is announced once, not twice.
    expect(alert.closest('[aria-live]')).toBeNull();
  });

  it('keeps routine error toasts open until the operator dismisses them', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Save failed" type="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Save failed').closest('.toast')).toHaveAttribute('data-state', 'open');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Save failed' }));
    await act(async () => vi.advanceTimersByTime(160));
    expect(screen.queryByText('Save failed')).toBeNull();
  });

  it.each([
    ['error', 'rect'],
    ['warning', 'polygon'],
    ['success', 'circle'],
    ['info', 'circle'],
  ] as const)('marks %s toasts with a visible shape glyph, not colour alone', (type, shape) => {
    render(
      <ToastProvider>
        <ToastTrigger message="Severity check" type={type} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    const glyph = screen.getByText('Severity check').querySelector('.toast-glyph');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph).toHaveClass(`toast-glyph--${type}`);
    expect(glyph?.querySelector(shape)).not.toBeNull();
  });

  it('names the dismiss button after a shortened copy of its message', () => {
    const long = `Couldn't save ${'very '.repeat(20)}long message`;
    render(
      <ToastProvider>
        <ToastTrigger message={long} type="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    const name = screen.getByRole('button', { name: /^Dismiss: Couldn't save very/ });
    expect(name.getAttribute('aria-label')).toHaveLength('Dismiss: '.length + 60);
    expect(name.getAttribute('aria-label')).toMatch(/…$/);
  });

  it('pauses auto-close while the toast is hovered and resumes after leave', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Hover me" type="success" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    const toast = screen.getByText('Hover me').closest('.toast') as HTMLElement;

    await act(async () => vi.advanceTimersByTime(3_000));
    fireEvent.mouseEnter(toast);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(toast).toHaveAttribute('data-state', 'open');

    fireEvent.mouseLeave(toast);
    await act(async () => vi.advanceTimersByTime(999));
    expect(toast).toHaveAttribute('data-state', 'open');
    await act(async () => vi.advanceTimersByTime(1));
    expect(toast).toHaveAttribute('data-state', 'closing');
  });

  it('pauses auto-close while focus is inside the toast', async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Focus me" type="info" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByTestId('trigger'));
    const dismiss = screen.getByRole('button', { name: 'Dismiss: Focus me' });
    const toast = dismiss.closest('.toast') as HTMLElement;

    act(() => dismiss.focus());
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(toast).toHaveAttribute('data-state', 'open');

    act(() => dismiss.blur());
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(toast).toHaveAttribute('data-state', 'closing');
  });

  it('renders the toast container with aria-label', () => {
    render(
      <ToastProvider>
        <div />
      </ToastProvider>,
    );
    expect(screen.getByRole('region', { name: 'Messages' })).toBeInTheDocument();
  });

  it.each([
    ['times out', 'timeout'],
    ['is dismissed', 'dismiss'],
  ] as const)('runs onDismiss once when an undo toast %s without Undo', async (_name, exit) => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastProvider>
        <UndoToastTrigger onUndo={onUndo} onDismiss={onDismiss} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ada' }));
    expect(onDismiss).not.toHaveBeenCalled();

    if (exit === 'dismiss') {
      fireEvent.click(screen.getByRole('button', { name: /^Dismiss: / }));
    } else {
      await act(async () => vi.advanceTimersByTime(6_000));
    }
    await act(async () => vi.advanceTimersByTime(160));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('does not run onDismiss when the toast action is taken', async () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastProvider>
        <UndoToastTrigger onUndo={onUndo} onDismiss={onDismiss} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => vi.advanceTimersByTime(160));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('runs a pending onDismiss when the provider unmounts', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <ToastProvider>
        <UndoToastTrigger onUndo={vi.fn()} onDismiss={onDismiss} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Ada' }));
    unmount();

    expect(onDismiss).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText('Noop')).toBeNull();
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
