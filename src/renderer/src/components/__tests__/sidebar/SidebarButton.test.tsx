import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SidebarButton } from '../../sidebar/SidebarButton';

const sidebarCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);

const cssRule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replaceAll('.', '\\.')}\\s*{([^}]*)}`).exec(css)?.[1] ?? '';

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

  it('does not mark an inactive destination as the current page', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Notes" isActive={false} onClick={vi.fn()} />,
    );
    const button = screen.getByLabelText('Notes');
    expect(button).not.toHaveAttribute('aria-current');
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  it('marks the active destination with aria-current="page"', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Notes" isActive={true} onClick={vi.fn()} />,
    );
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-current', 'page');
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
    expect(buttonStyles).toContain('--sidebar-button-width: 136px');
    expect(buttonStyles).toContain('--sidebar-button-height: 56px');
    expect(buttonStyles).toContain('width: var(--sidebar-button-width)');
    expect(buttonStyles).toContain('height: var(--sidebar-button-height)');
  });

  it('keeps status buttons inside the standard navigation footprint', () => {
    const buttonStyles = cssBlockFor('.sidebar-button');
    const statusStyles = cssBlockFor('.sidebar-button--status');

    expect(buttonStyles).toContain('width: var(--sidebar-button-width)');
    expect(buttonStyles).toContain('height: var(--sidebar-button-height)');
    expect(statusStyles).not.toContain('display: grid');
    expect(statusStyles).not.toContain('grid-template');
    expect(sidebarCss).not.toContain('.sidebar-button-detail');
  });

  it('sets the status pip on the label line, right after the label', () => {
    const dotStyles = cssBlockFor('.sidebar-button-status-dot');

    expect(dotStyles).not.toContain('position: absolute');
    expect(dotStyles).toContain('flex: none');
    expect(dotStyles).toContain('width: 10px');
    expect(dotStyles).toContain('height: 10px');
    expect(cssBlockFor('.sidebar-button-heading')).toContain('display: flex');
  });

  it('does not give status buttons a health wash or health rail', () => {
    expect(sidebarCss).not.toContain('--sidebar-status-wash');
    expect(sidebarCss).not.toContain('--sidebar-status-rail');
  });

  it('keeps the Relay accent rail as the active-state signal', () => {
    const activeStyles = cssBlockFor('.sidebar-button--active');
    expect(activeStyles).toContain('border-left-color: var(--accent)');
    expect(activeStyles).toContain('color: var(--accent-bright)');
  });

  it('gives every status tone its own pip shape', () => {
    const toneBlock = (tone: string) =>
      new RegExp(
        String.raw`\.sidebar-button-status-dot\[data-status-tone='${tone}'\]\s*{([^}]*)}`,
      ).exec(sidebarCss)?.[1] ?? '';
    const declaration = (block: string, property: string) => {
      const start = block.indexOf(`${property}:`);
      if (start === -1) return undefined;
      return block.slice(start + property.length + 1, block.indexOf(';', start)).trim();
    };
    const shapeOf = (tone: string) => {
      const block = toneBlock(tone);
      return declaration(block, 'clip-path') ?? declaration(block, 'border-radius');
    };

    // No data = hollow ring (base); healthy = filled circle (base radius, border removed).
    expect(cssBlockFor('.sidebar-button-status-dot')).toContain('border: 2px solid');
    expect(toneBlock('green')).toContain('border: none');
    const filledShapes = ['yellow', 'red', 'magenta'].map(shapeOf);
    expect(filledShapes.every(Boolean)).toBe(true);
    expect(new Set(filledShapes).size).toBe(filledShapes.length);
    expect(toneBlock('magenta')).toContain('clip-path: polygon(50% 0, 100% 100%, 0 100%)');
    expect(toneBlock('magenta')).toContain('var(--radar-magenta)');
    expect(sidebarCss).not.toMatch(/#b200ff/i);
    // A failing feed: slashed ring in neutral ink, never the alarm colour.
    expect(toneBlock('failed')).toContain('linear-gradient(');
    expect(toneBlock('failed')).not.toContain('--color-danger');
  });

  it('shows the destination shortcut in the tooltip and exposes it to assistive tech', () => {
    (globalThis as Record<string, unknown>).api = { platform: 'darwin' };
    render(
      <SidebarButton
        icon={<span>icon</span>}
        label="Compose"
        isActive={false}
        onClick={vi.fn()}
        shortcutKey="1"
      />,
    );

    const button = screen.getByRole('button', { name: 'Compose' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+1 Control+1');
    fireEvent.mouseEnter(button);
    expect(document.body.querySelector('.sidebar-tooltip-key')).toHaveTextContent('⌘1');
    delete (globalThis as Record<string, unknown>).api;
  });

  it('uses Ctrl in the tooltip shortcut off macOS', () => {
    (globalThis as Record<string, unknown>).api = { platform: 'win32' };
    render(
      <SidebarButton
        icon={<span>icon</span>}
        label="Tickets"
        isActive={false}
        onClick={vi.fn()}
        shortcutKey="8"
      />,
    );

    const button = screen.getByRole('button', { name: 'Tickets' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+8 Meta+8');
    fireEvent.mouseEnter(button);
    expect(document.body.querySelector('.sidebar-tooltip-key')).toHaveTextContent('Ctrl+8');
    delete (globalThis as Record<string, unknown>).api;
  });

  it('omits the shortcut when the destination has none', () => {
    render(
      <SidebarButton icon={<span>icon</span>} label="Home" isActive={false} onClick={vi.fn()} />,
    );

    const button = screen.getByRole('button', { name: 'Home' });
    expect(button).not.toHaveAttribute('aria-keyshortcuts');
    fireEvent.mouseEnter(button);
    expect(document.body.querySelector('.sidebar-tooltip-key')).toBeNull();
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

  it('renders one semantic dot without a persistent detail row', () => {
    const { container } = render(
      <SidebarButton
        {...baseProps}
        status={{
          tone: 'yellow',
          announcement: 'Warning. XCenter OK 2,000, Pending 1,807',
        }}
      />,
    );

    const dots = container.querySelectorAll('.sidebar-button-status-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('data-status-tone', 'yellow');
    expect(dots[0]).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sidebar-button-detail')).toBeNull();
    expect(screen.getByText('Radar')).toBeInTheDocument();
  });

  it('renders no semantic dot for an ordinary navigation button', () => {
    const { container } = render(<SidebarButton {...baseProps} status={null} />);
    expect(container.querySelector('.sidebar-button-status-dot')).toBeNull();
  });

  it('puts the pip after the label and the state word on its own full-width line under it', () => {
    const { container } = render(
      <SidebarButton
        {...baseProps}
        status={{
          tone: 'failed',
          announcement: 'Radar unavailable: no data has loaded',
          word: 'Unavailable',
        }}
      />,
    );

    const button = container.querySelector('button.sidebar-button')!;
    expect(button).toHaveClass('sidebar-button--has-word');
    const heading = button.querySelector('.sidebar-button-heading')!;
    expect(heading.children[0]).toHaveClass('sidebar-button-label');
    expect(heading.children[1]).toHaveClass('sidebar-button-status-dot');
    expect(heading.children[1]).toHaveAttribute('data-status-tone', 'failed');
    const state = heading.nextElementSibling!;
    expect(state).toHaveClass('sidebar-button-state');
    expect(state).toHaveAttribute('aria-hidden', 'true');
    expect(state.children).toHaveLength(1);
    expect(state.children[0]).toHaveClass('sidebar-button-status-word');
    expect(state.children[0]).toHaveTextContent('Unavailable');
    expect(container.querySelectorAll('.sidebar-button-status-dot')).toHaveLength(1);

    // One line at every viewport: 14 px (the --text-xs floor) fits "99+ unaddressed" in 112 px.
    const line = cssRule(sidebarCss, '.sidebar-button-state');
    expect(line).toContain('font-size: 14px');
    expect(line).toContain('flex-wrap: nowrap');
    expect(cssRule(sidebarCss, '.sidebar-button-status-word')).not.toContain('position: absolute');
    expect(cssRule(sidebarCss, '.sidebar-button--has-word')).toContain(
      'min-height: var(--sidebar-button-height)',
    );
  });

  it('folds the status and exact figures into the accessible name', () => {
    render(
      <SidebarButton
        {...baseProps}
        status={{
          tone: 'red',
          announcement: 'Critical. XCenter OK 5, Pending 9,000',
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

  it('still reports the current page while showing a status', () => {
    render(
      <SidebarButton {...baseProps} isActive status={{ tone: 'green', announcement: 'Healthy' }} />,
    );

    expect(screen.getByRole('button', { name: 'Radar — Healthy' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows the status beside its pip in the tooltip', () => {
    render(
      <SidebarButton
        {...baseProps}
        status={{ tone: 'magenta', announcement: 'Board Attention' }}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Radar — Board Attention' }));

    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(tooltip).toHaveTextContent('Radar');
    expect(tooltip).toHaveTextContent('Board Attention');
    expect(tooltip?.querySelector('.sidebar-tooltip-pip')).toHaveAttribute(
      'data-status-tone',
      'magenta',
    );
  });

  it('says the Problems count and "unaddressed" on the state line, under the warning diamond', () => {
    const { container } = render(
      <SidebarButton
        {...baseProps}
        label="Problems"
        status={{
          tone: 'yellow',
          word: '2',
          noun: 'unaddressed',
          announcement: '2 unaddressed problems',
        }}
      />,
    );

    const button = screen.getByRole('button', {
      name: 'Problems · 2 unaddressed — 2 unaddressed problems',
    });
    expect(button).toHaveClass('sidebar-button--has-word');
    expect(
      container.querySelector('.sidebar-button-heading .sidebar-button-status-dot'),
    ).toHaveAttribute('data-status-tone', 'yellow');
    const state = container.querySelector('.sidebar-button-state');
    expect(state?.querySelector('.sidebar-button-status-dot')).toBeNull();
    expect(state?.children[0]).toHaveClass('sidebar-button-status-word');
    expect(state?.children[0]).toHaveTextContent('2');
    // Count and noun share the one state line.
    expect(state?.children[1]).toHaveClass('sidebar-button-status-noun');
    expect(state?.children[1]).toHaveTextContent('unaddressed');
    expect(container.querySelector('.count-badge')).toBeNull();

    fireEvent.mouseEnter(button);
    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(tooltip).toHaveTextContent('2 unaddressed problems');
    expect(tooltip?.querySelector('.sidebar-tooltip-pip')).toHaveAttribute(
      'data-status-tone',
      'yellow',
    );
  });

  it('gives each state word its tone ink: alarm, warning, or secondary for failing', () => {
    const inkFor = (tone: string, part: string) =>
      new RegExp(
        String.raw`\[data-status-tone='${tone}'\] \.sidebar-button-status-${part}\s*{\s*color: ([^;]+);`,
      ).exec(sidebarCss)?.[1];
    expect(inkFor('red', 'word')).toBe('var(--alarm-bright)');
    expect(inkFor('yellow', 'noun')).toBe('var(--warning-bright)');
    expect(sidebarCss).toContain(
      ".sidebar-button[data-status-tone='yellow'] .sidebar-button-status-word,\n",
    );
    expect(inkFor('failed', 'word')).toBe('var(--color-text-secondary)');
  });

  it('marks a possibly stale count with a slashed-ring mark on the label line, never by decorating the word', () => {
    const { container, rerender } = render(
      <SidebarButton
        {...baseProps}
        label="Problems"
        status={{
          tone: 'yellow',
          word: '2',
          noun: 'unaddressed',
          announcement: '2 unaddressed problems',
        }}
      />,
    );
    expect(container.querySelector('.sidebar-button-stale-mark')).toBeNull();

    rerender(
      <SidebarButton
        {...baseProps}
        label="Problems"
        status={{
          tone: 'yellow',
          word: '2',
          noun: 'unaddressed',
          stale: true,
          announcement: '2 unaddressed problems · Dynatrace sync off — count may be stale',
        }}
      />,
    );
    const marker = container.querySelector(
      '.sidebar-button-heading .sidebar-button-status-dot + .sidebar-button-stale-mark',
    );
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.sidebar-button-state')?.children).toHaveLength(2);
    // The mark is the failing feed's slashed ring, drawn by the same rule.
    expect(sidebarCss).toContain(
      ".sidebar-button-stale-mark,\n.sidebar-button-status-dot[data-status-tone='failed'] {",
    );
    expect(container.querySelector('.sidebar-button-status-word')).toHaveTextContent(/^2$/);
    expect(
      screen.getByRole('button', {
        name: 'Problems · 2 unaddressed · not syncing — 2 unaddressed problems · Dynatrace sync off — count may be stale',
      }),
    ).toBeInTheDocument();
    expect(sidebarCss).not.toContain('underline dashed');

    const button = screen.getByRole('button', { name: /^Problems · 2 unaddressed · not syncing/ });
    fireEvent.mouseEnter(button);
    const tooltip = document.body.querySelector('.tooltip-popup');
    expect(
      tooltip?.querySelector('.sidebar-button-stale-mark')?.nextElementSibling,
    ).toHaveTextContent('Not syncing');
  });
});
