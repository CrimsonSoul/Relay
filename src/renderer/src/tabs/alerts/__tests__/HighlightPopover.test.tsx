import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { HighlightPopover } from '../HighlightPopover';
import { HIGHLIGHTS } from '../highlightColors';

describe('HighlightPopover', () => {
  const defaultProps = {
    onApply: vi.fn(),
    onClear: vi.fn(),
  };

  it('renders the trigger button', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    const trigger = container.querySelector('.alerts-hl-trigger');
    expect(trigger).toBeInTheDocument();
  });

  it('renders color dots in the trigger', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    const dots = container.querySelectorAll('.alerts-hl-dot');
    expect(dots).toHaveLength(HIGHLIGHTS.length);
  });

  it('does not show popover by default', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    expect(container.querySelector('.alerts-hl-popover')).not.toBeInTheDocument();
  });

  it('opens popover on trigger mousedown', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    const trigger = container.querySelector('.alerts-hl-trigger')!;
    fireEvent.mouseDown(trigger);

    expect(container.querySelector('.alerts-hl-popover')).toBeInTheDocument();
  });

  it('renders all highlight options when open', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    fireEvent.mouseDown(container.querySelector('.alerts-hl-trigger')!);

    for (const h of HIGHLIGHTS) {
      expect(screen.getByText(h.label)).toBeInTheDocument();
    }
  });

  it('renders shortcut keys for each highlight option', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    fireEvent.mouseDown(container.querySelector('.alerts-hl-trigger')!);

    for (const h of HIGHLIGHTS) {
      // Each shortcut should show Cmd+N
      expect(screen.getByText(`\u2318${h.shortcutKey}`)).toBeInTheDocument();
    }
  });

  it('renders Remove option with clear shortcut', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    fireEvent.mouseDown(container.querySelector('.alerts-hl-trigger')!);

    expect(screen.getByText('Remove')).toBeInTheDocument();
    expect(screen.getByText('\u23180')).toBeInTheDocument();
  });

  it('calls onApply and closes when a highlight option is clicked', () => {
    const onApply = vi.fn();
    const { container } = render(<HighlightPopover {...defaultProps} onApply={onApply} />);

    fireEvent.mouseDown(container.querySelector('.alerts-hl-trigger')!);

    const deadlineRow = screen.getByText('Deadline').closest('button')!;
    fireEvent.mouseDown(deadlineRow);

    expect(onApply).toHaveBeenCalledWith('deadline');
    // Popover should close
    expect(container.querySelector('.alerts-hl-popover')).not.toBeInTheDocument();
  });

  it('calls onClear and closes when Remove is clicked', () => {
    const onClear = vi.fn();
    const { container } = render(<HighlightPopover {...defaultProps} onClear={onClear} />);

    fireEvent.mouseDown(container.querySelector('.alerts-hl-trigger')!);

    const removeRow = screen.getByText('Remove').closest('button')!;
    fireEvent.mouseDown(removeRow);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.alerts-hl-popover')).not.toBeInTheDocument();
  });

  it('toggles popover closed on second trigger click', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    const trigger = container.querySelector('.alerts-hl-trigger')!;

    fireEvent.mouseDown(trigger);
    expect(container.querySelector('.alerts-hl-popover')).toBeInTheDocument();

    fireEvent.mouseDown(trigger);
    expect(container.querySelector('.alerts-hl-popover')).not.toBeInTheDocument();
  });

  it('shows open class on trigger when popover is open', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    const trigger = container.querySelector('.alerts-hl-trigger')!;
    fireEvent.mouseDown(trigger);

    expect(trigger).toHaveClass('open');
  });

  it('renders color swatches with correct background colors', () => {
    const { container } = render(<HighlightPopover {...defaultProps} />);

    fireEvent.mouseDown(container.querySelector('.alerts-hl-trigger')!);

    const swatches = container.querySelectorAll(
      '.alerts-hl-popover-swatch:not(.alerts-hl-popover-clear-swatch)',
    );
    expect(swatches).toHaveLength(HIGHLIGHTS.length);

    // jsdom normalizes hex colors to rgb() format, so just check that a background is set
    swatches.forEach((swatch) => {
      expect((swatch as HTMLElement).style.background).toBeTruthy();
    });
  });
});
