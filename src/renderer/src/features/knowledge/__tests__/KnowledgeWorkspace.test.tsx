import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeWorkspace } from '../KnowledgeWorkspace';
import {
  acknowledgeKnowledgeDestinationOpen,
  KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY,
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
  requestKnowledgeDestinationOpen,
  type KnowledgeDestination,
} from '../knowledgeWorkspaceNavigation';
import {
  acknowledgeKnowledgeDocumentOpen,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
  requestKnowledgeDocumentOpen,
} from '../knowledgeNavigation';

vi.mock('../KnowledgeHome', () => ({
  KnowledgeHome: ({
    wikiCount,
    contactCount,
    serverCount,
    onOpen,
  }: {
    wikiCount: number | null;
    contactCount: number | null;
    serverCount: number | null;
    onOpen: (destination: Exclude<KnowledgeDestination, 'home'>) => void;
  }) => (
    <div data-testid="knowledge-home">
      <span>{String(wikiCount)} wiki documents</span>
      <span>{contactCount} contacts</span>
      <span>{serverCount} servers</span>
      <button onClick={() => onOpen('wiki')}>Open Wiki</button>
      <button onClick={() => onOpen('contacts')}>Open Contacts</button>
      <button onClick={() => onOpen('servers')}>Open Servers</button>
    </div>
  ),
}));

const surfaceMocks = vi.hoisted(() => ({
  wikiShouldThrow: false,
  wikiEffectStarted: vi.fn(),
  wikiEffectCleanedUp: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  loggers: { ui: { error: vi.fn() } },
}));

vi.mock('../KnowledgeTab', async () => {
  const { useEffect, useState } = await import('react');
  return {
    KnowledgeTab: ({
      active,
      relayMode,
      onLibraryCountChange,
    }: {
      active: boolean;
      relayMode?: string;
      onLibraryCountChange?: (count: number | null) => void;
    }) => {
      const [page, setPage] = useState(1);
      useEffect(() => {
        surfaceMocks.wikiEffectStarted();
        return () => surfaceMocks.wikiEffectCleanedUp();
      }, []);
      if (surfaceMocks.wikiShouldThrow) throw new Error('Wiki surface failed');
      return (
        <div data-testid="wiki-surface" data-active={active} data-relay-mode={relayMode}>
          <span>Page {page} of 23</span>
          <button type="button" onClick={() => setPage(8)}>
            Open page 8 match
          </button>
          <button onClick={() => onLibraryCountChange?.(3)}>Publish Wiki count</button>
        </div>
      );
    },
  };
});

vi.mock('../../../tabs/DirectoryTab', async () => {
  const { useState } = await import('react');
  return {
    DirectoryTab: ({
      contacts,
      groups,
      servers,
      onAddToAssembler,
    }: {
      contacts: Array<{ name: string }>;
      groups: unknown[];
      servers: unknown[];
      onAddToAssembler: (contact: never) => void;
    }) => {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <div data-testid="contacts-surface">
          <span>{contacts.length} contact props</span>
          <span>{groups.length} group props</span>
          <span>{servers.length} related server props</span>
          {contacts.map((contact) => (
            <div
              key={contact.name}
              role="option"
              tabIndex={0}
              aria-selected={selected === contact.name}
              onClick={() => setSelected(contact.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setSelected(contact.name);
              }}
            >
              {contact.name}
            </div>
          ))}
          <button onClick={() => onAddToAssembler(contacts[0] as never)}>Add first contact</button>
        </div>
      );
    },
  };
});

vi.mock('../../../tabs/ServersTab', () => ({
  ServersTab: ({
    servers,
    contacts,
  }: {
    servers: Array<{ name: string }>;
    contacts: unknown[];
  }) => (
    <div data-testid="servers-surface">
      <span>{servers.length} server props</span>
      <span>{contacts.length} related contact props</span>
      {servers.map((server) => (
        <span key={server.name}>{server.name}</span>
      ))}
    </div>
  ),
}));

const contacts = [{ name: 'Ada Lovelace' }] as never;
const groups = [{ id: 'ops' }] as never;
const servers = [{ name: 'api-prod-01' }] as never;

function renderWorkspace(onAddToAssembler = vi.fn()) {
  return render(
    <KnowledgeWorkspace
      active
      contacts={contacts}
      groups={groups}
      servers={servers}
      relayMode="server"
      onAddToAssembler={onAddToAssembler}
    />,
  );
}

function visiblePanel() {
  return document.querySelector('[data-knowledge-panel][data-state="active"]');
}

describe('KnowledgeWorkspace', () => {
  beforeEach(() => {
    localStorage.removeItem(KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY);
    surfaceMocks.wikiEffectStarted.mockClear();
    surfaceMocks.wikiEffectCleanedUp.mockClear();
  });

  afterEach(() => {
    acknowledgeKnowledgeDocumentOpen('pending-doc');
    acknowledgeKnowledgeDestinationOpen('wiki');
    acknowledgeKnowledgeDestinationOpen('contacts');
    acknowledgeKnowledgeDestinationOpen('servers');
    surfaceMocks.wikiShouldThrow = false;
    vi.restoreAllMocks();
  });

  it('starts on the Knowledge home with launcher counts', () => {
    renderWorkspace();

    expect(screen.getByTestId('knowledge-home')).toBeInTheDocument();
    expect(screen.getByText('null wiki documents')).toBeInTheDocument();
    expect(screen.getByText('1 contacts')).toBeInTheDocument();
    expect(screen.getByText('1 servers')).toBeInTheDocument();
    expect(visiblePanel()).toHaveAttribute('data-destination', 'home');
  });

  it('restores the last content destination on the next Knowledge mount', async () => {
    const first = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts' }));
    await screen.findByTestId('contacts-surface');
    first.unmount();

    renderWorkspace();

    expect(visiblePanel()).toHaveAttribute('data-destination', 'contacts');
  });

  it('does not replace the last content destination when Home is opened explicitly', async () => {
    const first = renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    await screen.findByTestId('wiki-surface');
    fireEvent.click(screen.getByRole('button', { name: /Knowledge Home/ }));
    first.unmount();

    renderWorkspace();

    expect(visiblePanel()).toHaveAttribute('data-destination', 'wiki');
  });

  it.each([
    ['Open Wiki', 'wiki'],
    ['Open Contacts', 'contacts'],
    ['Open Servers', 'servers'],
  ] as const)('opens %s from the launcher', (buttonName, destination) => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    expect(visiblePanel()).toHaveAttribute('data-destination', destination);
    expect(screen.getByRole('button', { name: /Knowledge Home/ })).toBeInTheDocument();
  });

  it('navigates among explicit destinations and back to Knowledge home', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));

    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(visiblePanel()).toHaveAttribute('data-destination', 'contacts');
    expect(screen.getByRole('button', { name: 'Contacts' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: /Knowledge Home/ }));
    expect(visiblePanel()).toHaveAttribute('data-destination', 'home');
    expect(
      screen.queryByRole('navigation', { name: 'Knowledge destinations' }),
    ).not.toBeInTheDocument();
  });

  it('reports the active destination for global-search result ranking', () => {
    const onDestinationChange = vi.fn();
    render(
      <KnowledgeWorkspace
        active
        contacts={contacts}
        groups={groups}
        servers={servers}
        relayMode="server"
        onAddToAssembler={vi.fn()}
        onDestinationChange={onDestinationChange}
      />,
    );

    expect(onDestinationChange).toHaveBeenLastCalledWith('home');
    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts' }));
    expect(onDestinationChange).toHaveBeenLastCalledWith('contacts');
  });

  it('uses the approved destination navigation order', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));

    const navigation = screen.getByRole('navigation', { name: 'Knowledge destinations' });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Knowledge Home', 'Wiki', 'Contacts', 'Servers']);
    const home = within(navigation).getByRole('button', { name: 'Knowledge Home' });
    expect(home.querySelector('svg')).not.toBeNull();
    expect(home).not.toHaveTextContent('←');
  });

  it('retains Contacts selection after visiting Wiki', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts' }));
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));

    expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps Wiki effects alive while Contacts is the active retained destination', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    expect(await screen.findByTestId('wiki-surface')).toBeInTheDocument();
    expect(surfaceMocks.wikiEffectStarted).toHaveBeenCalledOnce();
    expect(surfaceMocks.wikiEffectCleanedUp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(await screen.findByTestId('contacts-surface')).toBeInTheDocument();
    expect(screen.getByTestId('wiki-surface')).toHaveAttribute('data-active', 'true');
    expect(surfaceMocks.wikiEffectCleanedUp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
    expect(await screen.findByTestId('wiki-surface')).toBeInTheDocument();
    expect(surfaceMocks.wikiEffectStarted).toHaveBeenCalledOnce();
    expect(surfaceMocks.wikiEffectCleanedUp).not.toHaveBeenCalled();
  });

  it('retains the Wiki reader through a Contacts round trip without an error boundary', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open page 8 match' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));

    expect(await screen.findByText('Page 8 of 23')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wiki unavailable' })).not.toBeInTheDocument();
  });

  it('opens destinations requested by external navigation events', () => {
    renderWorkspace();

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent(OPEN_KNOWLEDGE_DESTINATION_EVENT, { detail: 'servers' }),
      );
    });

    expect(visiblePanel()).toHaveAttribute('data-destination', 'servers');
  });

  it('forces Wiki open for document-open requests', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts' }));

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent(OPEN_KNOWLEDGE_DOCUMENT_EVENT, { detail: { documentId: 'kb-1' } }),
      );
    });

    expect(visiblePanel()).toHaveAttribute('data-destination', 'wiki');
  });

  it('opens Wiki when a document request arrived before the workspace mounted', () => {
    requestKnowledgeDocumentOpen('pending-doc');

    renderWorkspace();

    expect(visiblePanel()).toHaveAttribute('data-destination', 'wiki');
    acknowledgeKnowledgeDocumentOpen('pending-doc');
  });

  it.each(['contacts', 'servers'] as const)(
    'opens a pending %s request before lazy workspace render and remembers it',
    async (requestedDestination) => {
      requestKnowledgeDestinationOpen(requestedDestination);

      const firstWorkspace = renderWorkspace();
      expect(visiblePanel()).toHaveAttribute('data-destination', requestedDestination);
      await screen.findByTestId(`${requestedDestination}-surface`);
      firstWorkspace.unmount();

      renderWorkspace();
      expect(visiblePanel()).toHaveAttribute('data-destination', requestedDestination);
    },
  );

  it('keeps a failed Wiki surface isolated and allows navigation and retry recovery', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    surfaceMocks.wikiShouldThrow = true;
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    expect(await screen.findByRole('heading', { name: 'Wiki unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Servers' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Return to Knowledge' }));
    expect(visiblePanel()).toHaveAttribute('data-destination', 'home');
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    expect(screen.getByRole('heading', { name: 'Wiki unavailable' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Servers' }));
    expect(visiblePanel()).toHaveAttribute('data-destination', 'servers');
    expect(await screen.findByTestId('servers-surface')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
    expect(screen.getByRole('heading', { name: 'Wiki unavailable' })).toBeInTheDocument();
    surfaceMocks.wikiShouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Wiki again' }));
    expect(await screen.findByTestId('wiki-surface')).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it('shows the live Wiki count on Home after the Wiki snapshot loads', async () => {
    renderWorkspace();
    expect(screen.getByText('null wiki documents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish Wiki count' }));
    fireEvent.click(screen.getByRole('button', { name: /Knowledge Home/ }));

    expect(screen.getByText('3 wiki documents')).toBeInTheDocument();
  });

  it('passes the live Contact and Server data through their explicit surfaces', () => {
    const onAddToAssembler = vi.fn();
    renderWorkspace(onAddToAssembler);

    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts' }));
    expect(screen.getByText('1 contact props')).toBeInTheDocument();
    expect(screen.getByText('1 group props')).toBeInTheDocument();
    expect(screen.getByText('1 related server props')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add first contact' }));
    expect(onAddToAssembler).toHaveBeenCalledWith(contacts[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Servers' }));
    expect(screen.getByText('1 server props')).toBeInTheDocument();
    expect(screen.getByText('1 related contact props')).toBeInTheDocument();
  });
});
