import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeHome } from '../KnowledgeHome';

function cssBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

function declaration(block: string, property: string): string | undefined {
  return new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(block)?.[1].trim();
}

describe('KnowledgeHome', () => {
  it('uses square destination panels while keeping the monogram tiles subtly rounded', () => {
    const css = readFileSync('src/renderer/src/features/knowledge/knowledgeWorkspace.css', 'utf8');

    expect(declaration(cssBlock(css, '.knowledge-home__destination'), 'border-radius')).toBe('0');
    expect(declaration(cssBlock(css, '.knowledge-home__destination-icon'), 'border-radius')).toBe(
      '5px',
    );
  });

  it('renders Wiki, Contacts, and Servers in DOM and focus order', () => {
    const onOpen = vi.fn();
    render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={onOpen} />);

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(
      screen.getByRole('heading', {
        name: 'Get Connected To The People, Systems, And Guidance You Need — All In One Place',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Knowledge workspace')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Open a directory below. Each workspace stays focused while sharing one dependable place in Relay.',
      ),
    ).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Wiki'),
      expect.stringContaining('Contacts'),
      expect.stringContaining('Servers'),
    ]);

    buttons.forEach((button) => expect(button).toHaveClass('knowledge-home__destination'));
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();
  });

  it('keeps full destination interfaces out of the splash launchers', () => {
    render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={vi.fn()} />);

    expect(screen.queryByText('Checkout recovery')).not.toBeInTheDocument();
    expect(screen.queryByText('A. Rivera')).not.toBeInTheDocument();
    expect(screen.queryByText('api-prod-01')).not.toBeInTheDocument();
  });

  it.each([
    ['Wiki', 'wiki'],
    ['Contacts', 'contacts'],
    ['Servers', 'servers'],
  ] as const)('opens %s from the launcher', (name, destination) => {
    const onOpen = vi.fn();
    render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Open ${name}`) }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(destination);
  });

  it('uses singular and plural count labels', () => {
    render(<KnowledgeHome wikiCount={1} contactCount={2} serverCount={1} onOpen={vi.fn()} />);

    expect(screen.getByText('1 document')).toBeInTheDocument();
    expect(screen.getByText('2 contacts')).toBeInTheDocument();
    expect(screen.getByText('1 server')).toBeInTheDocument();
  });

  it('shows unavailable labels for unknown counts', () => {
    render(
      <KnowledgeHome wikiCount={null} contactCount={null} serverCount={null} onOpen={vi.fn()} />,
    );

    expect(screen.getByText('Document count unavailable')).toBeInTheDocument();
    expect(screen.getByText('Contact count unavailable')).toBeInTheDocument();
    expect(screen.getByText('Server count unavailable')).toBeInTheDocument();
  });

  it('gives every destination a unique accessible name', () => {
    render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={vi.fn()} />);

    const accessibleNames = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));

    expect(accessibleNames).toEqual([
      'Open Wiki, 24 documents',
      'Open Contacts, 6 contacts',
      'Open Servers, 3 servers',
    ]);
    expect(new Set(accessibleNames).size).toBe(accessibleNames.length);
  });

  it('names the document destination Wiki instead of Knowledge Base', () => {
    render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Open Wiki/ })).toBeInTheDocument();
    expect(screen.queryByText('Knowledge Base')).not.toBeInTheDocument();
  });
});
