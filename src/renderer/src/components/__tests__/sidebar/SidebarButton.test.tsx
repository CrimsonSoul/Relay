import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SidebarButton } from '../../sidebar/SidebarButton';

const sidebarCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);

const cssBlockFor = (selector: string) => {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*{([^}]*)}`).exec(sidebarCss);
  return match?.[1] ?? '';
};

describe('SidebarButton', () => {
  it('renders with the label as aria-label', () => {
    render(
      <SidebarButton
        icon={<span>icon</span>}
        label="Directory"
        isActive={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Directory')).toBeInTheDocument();
  });

  it('sets data-testid based on label', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="On Call" isActive={false} onClick={vi.fn()} />,
    );
    expect(screen.getByTestId('sidebar-on-call')).toBeInTheDocument();
  });

  it('sets aria-pressed to false when not active', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Notes" isActive={false} onClick={vi.fn()} />,
    );
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets aria-pressed to true when active', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Notes" isActive={true} onClick={vi.fn()} />,
    );
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies active class when isActive is true', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Home" isActive={true} onClick={vi.fn()} />,
    );
    expect(screen.getByLabelText('Home')).toHaveClass('sidebar-button--active');
  });

  it('does not apply active class when isActive is false', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Home" isActive={false} onClick={vi.fn()} />,
    );
    expect(screen.getByLabelText('Home')).not.toHaveClass('sidebar-button--active');
  });

  it('calls onClick when button is clicked', () => {
    const onClick = vi.fn();
    render(
      <SidebarButton icon={<span>icon</span>} label="Tab" isActive={false} onClick={onClick} />,
    );
    fireEvent.click(screen.getByLabelText('Tab'));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows indicator when active', () => {
    const { container } = render(
      <SidebarButton icon={<span>icon</span>} label="Tab" isActive={true} onClick={vi.fn()} />,
    );
    expect(container.querySelector('.sidebar-button-indicator')).toBeTruthy();
  });

  it('does not show indicator when not active', () => {
    const { container } = render(
      <SidebarButton icon={<span>icon</span>} label="Tab" isActive={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector('.sidebar-button-indicator')).toBeNull();
  });

  it('renders the icon', () => {
    render(
      <SidebarButton
        icon={<span data-testid="the-icon">I</span>}
        label="Tab"
        isActive={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId('the-icon')).toBeInTheDocument();
  });

  it('shows the label in a tooltip on hover', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Status" isActive={false} onClick={vi.fn()} />,
    );

    expect(document.body.querySelector('.tooltip-popup')).toBeNull();
    fireEvent.mouseEnter(screen.getByLabelText('Status'));

    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(tooltip).toHaveTextContent('Status');
  });

  it('keeps the sidebar hover and active overlay at one fixed size', () => {
    const buttonStyles = cssBlockFor('.sidebar-button');
    expect(buttonStyles).toContain('--sidebar-button-width: 120px');
    expect(buttonStyles).toContain('--sidebar-button-height: 56px');
    expect(buttonStyles).toContain('width: var(--sidebar-button-width)');
    expect(buttonStyles).toContain('height: var(--sidebar-button-height)');
  });

  /**
   * The one deliberate exception to the fixed height above. A status button
   * carries a third line of figures, and 56px less padding fits the icon and
   * label only. The width stays pinned so the nav column keeps its rhythm, and
   * the floor is the standard height so a status button is never shorter.
   */
  it('lets only the status variant grow past the fixed height, and never narrower', () => {
    const statusStyles = cssBlockFor('.sidebar-button--status');
    expect(statusStyles).toContain('height: auto');
    expect(statusStyles).toContain('min-height: var(--sidebar-button-height)');
    expect(statusStyles).not.toContain('width:');
  });
});

describe('SidebarButton status', () => {
  const baseProps = {
    icon: <span>icon</span>,
    label: 'Radar',
    isActive: false,
    onClick: vi.fn(),
  };

  it('stays a plain button when it reports no status', () => {
    render(<SidebarButton {...baseProps} />);

    const button = screen.getByRole('button', { name: 'Radar' });
    expect(button).not.toHaveAttribute('data-status-tone');
    expect(button).not.toHaveClass('sidebar-button--status');
  });

  it('shows the figures alongside the icon and label', () => {
    render(
      <SidebarButton
        {...baseProps}
        status={{ tone: 'green', announcement: 'Healthy', detail: '2,000 · 1,807' }}
      />,
    );

    expect(screen.getByText('2,000 · 1,807')).toBeInTheDocument();
    expect(screen.getByText('Radar')).toBeInTheDocument();
  });

  /**
   * `aria-label` replaces a button's inner text for assistive tech, so figures
   * rendered in `detail` are only reachable if `announcement` repeats them.
   * Without this the button reads as a bare "Radar".
   */
  it('folds the status into the accessible name so the figures are not lost', () => {
    render(
      <SidebarButton
        {...baseProps}
        status={{
          tone: 'red',
          announcement: 'Critical. XCenter OK 5, Pending 9,000',
          detail: '5 · 9,000',
        }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Radar — Critical. XCenter OK 5, Pending 9,000' }),
    ).toBeInTheDocument();
  });

  it('carries the tone as data so the tint is styleable', () => {
    render(<SidebarButton {...baseProps} status={{ tone: 'yellow', announcement: 'Warning' }} />);

    const button = screen.getByRole('button', { name: 'Radar — Warning' });
    expect(button).toHaveAttribute('data-status-tone', 'yellow');
    expect(button).toHaveClass('sidebar-button--status');
  });

  it('omits the figures line when the status carries no detail', () => {
    const { container } = render(
      <SidebarButton {...baseProps} status={{ tone: 'unknown', announcement: 'Unknown' }} />,
    );

    expect(container.querySelector('.sidebar-button-detail')).toBeNull();
  });

  it('still reports the pressed state while showing a status', () => {
    render(
      <SidebarButton
        {...baseProps}
        isActive
        status={{ tone: 'green', announcement: 'Healthy', detail: '1 · 2' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Radar — Healthy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows the status in the tooltip too', () => {
    render(<SidebarButton {...baseProps} status={{ tone: 'red', announcement: 'Critical' }} />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Radar — Critical' }));

    expect(document.body.querySelector('.tooltip-popup')).toHaveTextContent('Radar — Critical');
  });
});
