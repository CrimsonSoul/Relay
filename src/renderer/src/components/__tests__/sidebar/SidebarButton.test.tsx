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
});
