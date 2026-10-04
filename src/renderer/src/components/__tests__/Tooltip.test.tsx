import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Tooltip, TOOLTIP_HIDE_GRACE_MS, TOOLTIP_VIEWPORT_MARGIN, placeTooltip } from '../Tooltip';

const rectAt = (left: number, top: number, width = 20, height = 20) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe('Tooltip', () => {
  it('renders the trigger child', () => {
    render(
      <Tooltip content="Hello">
        <button>Hover me</button>
      </Tooltip>,
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('does not show tooltip content initially', () => {
    render(
      <Tooltip content="Tooltip text">
        <button>Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByText('Tooltip text')).toBeNull();
  });

  it('shows tooltip content on mouse enter', () => {
    render(
      <Tooltip content="Helpful hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    expect(screen.getByText('Helpful hint')).toBeInTheDocument();
  });

  it('preserves the trigger child mouse handlers', () => {
    const onMouseEnter = vi.fn();

    render(
      <Tooltip content="Helpful hint">
        <button onMouseEnter={onMouseEnter}>Trigger</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByText('Trigger'));

    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Helpful hint')).toBeInTheDocument();
  });

  it('hides tooltip content on mouse leave after a short grace period', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Helpful hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    expect(screen.getByText('Helpful hint')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText('Trigger'));
    expect(screen.getByText('Helpful hint')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_HIDE_GRACE_MS);
    });
    expect(screen.queryByText('Helpful hint')).toBeNull();
    vi.useRealTimers();
  });

  it('stays open while the pointer moves onto the popup', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Hoverable hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    fireEvent.mouseLeave(screen.getByText('Trigger'));
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_HIDE_GRACE_MS * 3);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hoverable hint');

    fireEvent.mouseLeave(screen.getByRole('tooltip'));
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_HIDE_GRACE_MS);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
  });

  it('keeps a keyboard-opened popup when the pointer passes over and out of the trigger', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Focus hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    fireEvent.focus(trigger);
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveClass('tooltip-popup--hoverable');
    fireEvent.mouseLeave(trigger);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_HIDE_GRACE_MS * 3);
    });
    // Still open while focus stays, back to the click-through focus-opened state.
    expect(screen.getByRole('tooltip')).not.toHaveClass('tooltip-popup--hoverable');

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
  });

  it('closes on pointer leave once a pressed trigger has focus', () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Pressed hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    fireEvent.mouseEnter(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_HIDE_GRACE_MS);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
  });

  it('dismisses on Escape without moving focus', () => {
    render(
      <Tooltip content="Escapable hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    trigger.focus();
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes only the tooltip on Escape, leaving the next Escape to the modal beneath', () => {
    const modalEscape = vi.fn();
    document.addEventListener('keydown', modalEscape);
    render(
      <Tooltip content="Modal hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('Trigger'));

    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(first);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(first.defaultPrevented).toBe(true);
    expect(modalEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(modalEscape).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', modalEscape);
  });

  it('flips a popup off a cramped side and clamps it inside the viewport margin', () => {
    const viewport = { width: 1000, height: 600 };
    const popup = { width: 200, height: 40 };

    // Right edge: a top tooltip centred on a trigger at x 980 slides left.
    const right = placeTooltip(rectAt(970, 300), popup, 'top', viewport);
    expect(right.left - popup.width / 2).toBe(viewport.width - TOOLTIP_VIEWPORT_MARGIN - 200);
    // Top edge: no room above the trigger, so it flips below rather than covering the trigger.
    const top = placeTooltip(rectAt(400, 4), popup, 'top', viewport);
    expect(top).toMatchObject({ position: 'bottom', top: 4 + 20 + 8 });
    // Left edge: no room on the left, so it flips to the trigger's right.
    const left = placeTooltip(rectAt(30, 300), popup, 'left', viewport);
    expect(left).toMatchObject({ position: 'right', left: 30 + 20 + 8 });
    // Bottom edge: flips above.
    const bottom = placeTooltip(rectAt(400, 590), popup, 'bottom', viewport);
    expect(bottom).toMatchObject({ position: 'top', top: 590 - 8 });
    // No room on either side: held at the margin on the preferred side.
    const cramped = placeTooltip(rectAt(400, 4, 20, 580), popup, 'top', viewport);
    expect(cramped.position).toBe('top');
    expect(cramped.top - popup.height).toBe(TOOLTIP_VIEWPORT_MARGIN);
    // Room to spare: centred above the trigger, 8px off it.
    expect(placeTooltip(rectAt(400, 300), popup, 'top', viewport)).toEqual({
      left: 410,
      top: 292,
      position: 'top',
    });
  });

  it('re-places a visible popup inside the viewport when the page scrolls', () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    render(
      <Tooltip content="Edge hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rectAt(400, 300));
    fireEvent.mouseEnter(trigger);
    const popup = screen.getByRole('tooltip');
    expect(popup.style.left).toBe('410px');

    rectSpy.mockReturnValue(rectAt(globalThis.innerWidth - 10, 300));
    fireEvent.scroll(document.body);
    expect(popup.style.left).toBe(`${globalThis.innerWidth - TOOLTIP_VIEWPORT_MARGIN - 100}px`);

    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it('leaves Escape alone while no tooltip is visible', () => {
    render(
      <Tooltip content="Hidden hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('describes the trigger with the popup while visible', () => {
    render(
      <Tooltip content="Extra detail">
        <button aria-describedby="existing">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    expect(trigger).toHaveAttribute('aria-describedby', 'existing');
    fireEvent.mouseEnter(trigger);
    const popup = screen.getByRole('tooltip');
    expect(popup.id).not.toBe('');
    expect(trigger).toHaveAttribute('aria-describedby', `existing ${popup.id}`);
    expect(trigger).toHaveAccessibleDescription('Extra detail');
  });

  it('does not duplicate a description that equals the aria-label', () => {
    render(
      <Tooltip content="Settings">
        <button aria-label="Settings">S</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('stays visual only when describesTrigger is false', () => {
    render(
      <Tooltip content={<span>Alerts ⌘1</span>} describesTrigger={false}>
        <button aria-label="Alerts">A</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Alerts' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('closes a focus-opened popup when its trigger becomes disabled', () => {
    const { rerender } = render(
      <Tooltip content="Refresh now">
        <button>Refresh</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('Refresh'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    rerender(
      <Tooltip content="Refresh now">
        <button disabled>Refresh</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stays dismissed after the trigger is pressed until the pointer leaves', () => {
    render(
      <Tooltip content="Pressed hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    fireEvent.mouseEnter(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.focus(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('only takes pointer events when opened by the pointer', () => {
    render(
      <Tooltip content="Overlay hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByText('Trigger');
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).not.toHaveClass('tooltip-popup--hoverable');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveClass('tooltip-popup--hoverable');
  });

  it('shows tooltip on focus', () => {
    render(
      <Tooltip content="Focus tip">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('Trigger'));
    expect(screen.getByText('Focus tip')).toBeInTheDocument();
  });

  it('hides tooltip on blur', () => {
    render(
      <Tooltip content="Focus tip">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('Trigger'));
    fireEvent.blur(screen.getByText('Trigger'));
    expect(screen.queryByText('Focus tip')).toBeNull();
  });

  it('does not show tooltip when content is empty string', () => {
    render(
      <Tooltip content="">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    // Empty content should not render portal
    const popup = document.querySelector('.tooltip-popup');
    expect(popup).toBeNull();
  });

  it('applies block class when block prop is true', () => {
    const { container } = render(
      <Tooltip content="Block tooltip" block={true}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const triggerSpan = container.querySelector('.tooltip-trigger--block');
    expect(triggerSpan).not.toBeNull();
  });

  it('does not apply block class when block prop is false', () => {
    const { container } = render(
      <Tooltip content="Inline tooltip" block={false}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const triggerSpan = container.querySelector('.tooltip-trigger--block');
    expect(triggerSpan).toBeNull();
  });

  it('uses delay before showing tooltip when delay prop is set', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Delayed tip" delay={300}>
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    // Should not be visible yet
    expect(screen.queryByText('Delayed tip')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText('Delayed tip')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('cancels delayed tooltip on mouse leave before timeout', async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Cancelled tip" delay={500}>
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    // Partially advance time
    vi.advanceTimersByTime(200);
    fireEvent.mouseLeave(screen.getByText('Trigger'));
    // Advance past original delay
    vi.advanceTimersByTime(400);
    expect(screen.queryByText('Cancelled tip')).toBeNull();
    vi.useRealTimers();
  });

  it('clears delayed tooltip timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Tooltip content="Unmounted tip" delay={500}>
        <button>Trigger</button>
      </Tooltip>,
    );

    fireEvent.mouseEnter(screen.getByText('Trigger'));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('shows tooltip popup via portal in document.body', () => {
    render(
      <Tooltip content="Portal content">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    const popup = document.body.querySelector('.tooltip-popup');
    expect(popup).not.toBeNull();
    expect(popup?.textContent).toBe('Portal content');
  });

  it('applies correct width to tooltip popup', () => {
    render(
      <Tooltip content="Wide tip" width="200px">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    const popup = document.body.querySelector('.tooltip-popup') as HTMLElement;
    expect(popup.style.width).toBe('200px');
  });

  it('renders with different positions without errors', () => {
    for (const position of ['top', 'bottom', 'left', 'right'] as const) {
      render(
        <Tooltip content={`${position} tooltip`} position={position}>
          <button>{position} trigger</button>
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText(`${position} trigger`));
      expect(screen.getByText(`${position} tooltip`)).toBeInTheDocument();
      fireEvent.mouseLeave(screen.getByText(`${position} trigger`));
    }
  });
});
