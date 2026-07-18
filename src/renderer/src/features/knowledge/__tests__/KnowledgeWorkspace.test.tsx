import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeWorkspace } from '../KnowledgeWorkspace';
import {
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
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

vi.mock('../KnowledgeTab', () => ({
  KnowledgeTab: ({ active, relayMode }: { active: boolean; relayMode?: string }) => (
    <div data-testid="wiki-surface" data-active={active} data-relay-mode={relayMode}>
      Wiki surface
    </div>
  ),
}));

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
  afterEach(() => {
    acknowledgeKnowledgeDocumentOpen('pending-doc');
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

  it.each([
    ['Open Wiki', 'wiki'],
    ['Open Contacts', 'contacts'],
    ['Open Servers', 'servers'],
  ] as const)('opens %s from the launcher', (buttonName, destination) => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    expect(visiblePanel()).toHaveAttribute('data-destination', destination);
    expect(screen.getByRole('button', { name: /Knowledge home/ })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /Knowledge home/ }));
    expect(visiblePanel()).toHaveAttribute('data-destination', 'home');
    expect(
      screen.queryByRole('navigation', { name: 'Knowledge destinations' }),
    ).not.toBeInTheDocument();
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
