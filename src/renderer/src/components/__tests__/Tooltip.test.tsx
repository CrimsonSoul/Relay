import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Tooltip } from '../Tooltip';

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

  it('hides tooltip content on mouse leave', () => {
    render(
      <Tooltip content="Helpful hint">
        <button>Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('Trigger'));
    expect(screen.getByText('Helpful hint')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText('Trigger'));
    expect(screen.queryByText('Helpful hint')).toBeNull();
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
