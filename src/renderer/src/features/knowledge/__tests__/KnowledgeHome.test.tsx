import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeHome } from '../KnowledgeHome';
import { SearchProvider } from '../../../contexts';

describe('KnowledgeHome', () => {
  it('renders Wiki, Contacts, and Servers in DOM and focus order', () => {
    const onOpen = vi.fn();
    render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={onOpen} />);

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge' })).toHaveClass(
      'tab-page-header__title',
    );
    // Each card states its own count; the header does not repeat them.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/24 Wiki documents/)).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    const index = screen.getByRole('list', { name: 'Knowledge areas' });
    expect(index.querySelectorAll('li')).toHaveLength(3);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Wiki'),
      expect.stringContaining('Contacts'),
      expect.stringContaining('Servers'),
    ]);

    buttons.forEach((button) => expect(button).toHaveClass('knowledge-home__destination'));
    buttons[0]?.focus();
    expect(buttons[0]).toHaveFocus();
  });

  it('points the header at the app search instead of a second search field', () => {
    const searchInputRef = { current: null };
    render(
      <SearchProvider activeTab="Knowledge" searchInputRef={searchInputRef}>
        <KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={vi.fn()} />
      </SearchProvider>,
    );

    expect(screen.getByText(/finds any contact, server, or Wiki page/)).toHaveClass(
      'knowledge-home__search-hint',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows an icon, description, facts, count, and Open action on each card', () => {
    const { container } = render(
      <KnowledgeHome
        wikiCount={24}
        contactCount={6}
        serverCount={3}
        onOpen={vi.fn()}
        facts={{
          contacts: [{ label: 'Saved groups', value: '2' }],
          servers: [{ label: 'Without owner', value: '1' }],
        }}
      />,
    );

    const icons = container.querySelectorAll('.knowledge-home__destination-icon');
    expect(icons).toHaveLength(3);
    icons.forEach((icon) => expect(icon.querySelector('svg')).not.toBeNull());
    expect(screen.queryByText('WK')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.knowledge-home__destination-description')).toHaveLength(3);

    // Label in Name (WCAG 2.5.3): the visible command is the start of each accessible name.
    const contacts = screen.getByRole('button', { name: /^Open Contacts/ });
    expect(contacts).toHaveTextContent('Saved groups2');
    expect(contacts.querySelector('.knowledge-home__destination-open')).toHaveTextContent(
      'Open Contacts →',
    );
    const servers = screen.getByRole('button', { name: /^Open Servers/ });
    expect(servers).toHaveTextContent('Without owner1');
    expect(servers.querySelector('.knowledge-home__destination-open')).toHaveTextContent(
      'Open Servers →',
    );
    expect(screen.getByRole('button', { name: /Open Wiki/ })).toHaveTextContent(
      'SOP manuals, quick guides',
    );
  });

  it('lists Wiki guide types only once the Wiki has documents', () => {
    render(<KnowledgeHome wikiCount={0} contactCount={6} serverCount={3} onOpen={vi.fn()} />);

    const wiki = screen.getByRole('button', { name: /^Open Wiki, No documents yet/ });
    expect(wiki).toHaveTextContent('No documents yet');
    expect(wiki).not.toHaveTextContent('SOP manuals');
  });

  it('gives an empty Wiki a primary only when the user can add guides', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <KnowledgeHome wikiCount={0} contactCount={6} serverCount={3} onOpen={onOpen} />,
    );

    const findOwner = screen.getByRole('button', { name: 'Find an Owner in Contacts' });
    // Readers cannot do the Wiki's own task, so the route to an owner is a quiet secondary.
    expect(findOwner).toHaveClass('tactile-button--secondary');
    expect(document.querySelector('.tactile-button--primary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add PDF Guides' })).not.toBeInTheDocument();
    fireEvent.click(findOwner);
    expect(onOpen).toHaveBeenCalledWith('contacts');

    const onAddWikiGuides = vi.fn();
    rerender(
      <KnowledgeHome
        wikiCount={0}
        contactCount={6}
        serverCount={3}
        onOpen={onOpen}
        onAddWikiGuides={onAddWikiGuides}
      />,
    );
    const addGuides = screen.getByRole('button', { name: 'Add PDF Guides' });
    expect(addGuides).toHaveClass('tactile-button--primary');
    fireEvent.click(addGuides);
    expect(onAddWikiGuides).toHaveBeenCalledOnce();

    rerender(
      <KnowledgeHome
        wikiCount={4}
        contactCount={6}
        serverCount={3}
        onOpen={onOpen}
        onAddWikiGuides={onAddWikiGuides}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Add PDF Guides' })).not.toBeInTheDocument();
  });

  it('names its scope in the shared header subtitle', () => {
    render(<KnowledgeHome wikiCount={4} contactCount={6} serverCount={3} onOpen={vi.fn()} />);
    expect(screen.getByText('Wiki, contacts, servers')).toHaveClass('tab-page-header__subtitle');
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

  it('distinguishes a loading Wiki count and exposes retry only after failure', () => {
    const onRetryWikiCount = vi.fn();
    const { rerender } = render(
      <KnowledgeHome
        wikiCount={null}
        wikiCountLoading
        contactCount={6}
        serverCount={3}
        onOpen={vi.fn()}
        onRetryWikiCount={onRetryWikiCount}
      />,
    );

    expect(screen.getByText('Document count loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Wiki Count' })).not.toBeInTheDocument();

    rerender(
      <KnowledgeHome
        wikiCount={null}
        wikiCountLoading={false}
        contactCount={6}
        serverCount={3}
        onOpen={vi.fn()}
        onRetryWikiCount={onRetryWikiCount}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry Wiki Count' }));

    expect(onRetryWikiCount).toHaveBeenCalledOnce();
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
