import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import type { KnowledgeRecordOpenRequest } from '../knowledgeRecordNavigation';

let knowledgeStatusListener:
  | ((status: {
      state: 'idle' | 'indexing' | 'warning' | 'error';
      documentCount: number;
      categoryCount: number;
      lastIndexedAt: string | null;
    }) => void)
  | null = null;
const unsubscribeKnowledgeStatus = vi.fn();
const getKnowledgeIndexStatus = vi.fn();

vi.mock('../../../components/StatusBar', () => ({
  StatusBar: ({ left }: { left?: ReactNode }) => <div data-testid="status-bar">{left}</div>,
  StatusBarLive: () => <span>live connection</span>,
}));

vi.mock('../KnowledgeHome', () => ({
  KnowledgeHome: ({
    wikiCount,
    wikiCountLoading,
    contactCount,
    serverCount,
    onOpen,
    onRetryWikiCount,
    onAddWikiGuides,
    facts,
  }: {
    facts?: Record<string, ReadonlyArray<{ label: string; value: string }>>;
    wikiCount: number | null;
    wikiCountLoading?: boolean;
    contactCount: number | null;
    serverCount: number | null;
    onOpen: (destination: Exclude<KnowledgeDestination, 'home'>) => void;
    onRetryWikiCount?: () => void;
    onAddWikiGuides?: () => void;
  }) => (
    <div data-testid="knowledge-home">
      <span>{String(wikiCount)} wiki documents</span>
      <span>{wikiCountLoading ? 'wiki count loading' : 'wiki count settled'}</span>
      <span>{contactCount} contacts</span>
      <span>{serverCount} servers</span>
      {Object.entries(facts ?? {}).flatMap(([destination, items]) =>
        items.map((fact) => (
          <span key={`${destination}-${fact.label}`}>
            {destination} {fact.label}: {fact.value}
          </span>
        )),
      )}
      {wikiCount === null && !wikiCountLoading && (
        <button onClick={onRetryWikiCount}>Retry Wiki Count</button>
      )}
      <button onClick={() => onOpen('wiki')}>Open Wiki</button>
      <button onClick={() => onOpen('contacts')}>Open Contacts</button>
      <button onClick={() => onOpen('servers')}>Open Servers</button>
      {onAddWikiGuides && <button onClick={onAddWikiGuides}>Add PDF Guides</button>}
    </div>
  ),
}));

const surfaceMocks = vi.hoisted(() => ({
  wikiShouldThrow: false,
  wikiEffectStarted: vi.fn(),
  wikiEffectCleanedUp: vi.fn(),
  session: { state: 'inactive', capabilities: [] as string[] },
}));

vi.mock('../../../contexts/PrivilegedAccessContext', () => ({
  useOptionalPrivilegedAccess: () => ({ session: surfaceMocks.session }),
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
      addGuidesRequest = 0,
    }: {
      active: boolean;
      relayMode?: string;
      onLibraryCountChange?: (count: number | null) => void;
      addGuidesRequest?: number;
    }) => {
      const [page, setPage] = useState(1);
      useEffect(() => {
        surfaceMocks.wikiEffectStarted();
        return () => surfaceMocks.wikiEffectCleanedUp();
      }, []);
      if (surfaceMocks.wikiShouldThrow) throw new Error('Wiki surface failed');
      return (
        <div
          data-testid="wiki-surface"
          data-active={active}
          data-relay-mode={relayMode}
          data-add-guides-request={addGuidesRequest}
        >
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
      selectionRequest,
      onSelectionUnavailable,
    }: {
      contacts: Array<{ name: string }>;
      groups: unknown[];
      servers: unknown[];
      onAddToAssembler: (contact: never) => void;
      selectionRequest?: KnowledgeRecordOpenRequest | null;
      onSelectionUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
    }) => {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <div data-testid="contacts-surface">
          <span>{contacts.length} contact props</span>
          <span>{groups.length} group props</span>
          <span>{servers.length} related server props</span>
          <span data-testid="contacts-selection-request">
            {selectionRequest?.recordKey ?? 'no contact request'}
          </span>
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
          {selectionRequest && (
            <button onClick={() => onSelectionUnavailable?.(selectionRequest)}>
              Report missing contact
            </button>
          )}
        </div>
      );
    },
  };
});

vi.mock('../../../tabs/ServersTab', () => ({
  ServersTab: ({
    servers,
    contacts,
    selectionRequest,
    onSelectionUnavailable,
  }: {
    servers: Array<{ name: string }>;
    contacts: unknown[];
    selectionRequest?: KnowledgeRecordOpenRequest | null;
    onSelectionUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
  }) => (
    <div data-testid="servers-surface">
      <span>{servers.length} server props</span>
      <span>{contacts.length} related contact props</span>
      <span data-testid="servers-selection-request">
        {selectionRequest?.recordKey ?? 'no server request'}
      </span>
      {servers.map((server) => (
        <span key={server.name}>{server.name}</span>
      ))}
      {selectionRequest && (
        <button onClick={() => onSelectionUnavailable?.(selectionRequest)}>
          Report missing server
        </button>
      )}
    </div>
  ),
}));

const contacts = [{ name: 'Ada Lovelace', phone: '(555) 010-0001' }] as never;
const groups = [{ id: 'ops' }] as never;
const servers = [{ name: 'api-prod-01', businessArea: 'Payments', owner: '' }] as never;

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
    knowledgeStatusListener = null;
    unsubscribeKnowledgeStatus.mockClear();
    getKnowledgeIndexStatus.mockReset().mockResolvedValue({
      state: 'idle',
      documentCount: 7,
      categoryCount: 2,
      lastIndexedAt: '2026-09-04T12:00:00.000Z',
    });
    globalThis.api = {
      getKnowledgeIndexStatus,
      onKnowledgeIndexStatusChanged: vi.fn((listener) => {
        knowledgeStatusListener = listener;
        return unsubscribeKnowledgeStatus;
      }),
    } as never;
    surfaceMocks.wikiEffectStarted.mockClear();
    surfaceMocks.wikiEffectCleanedUp.mockClear();
  });

  afterEach(() => {
    acknowledgeKnowledgeDocumentOpen('pending-doc');
    acknowledgeKnowledgeDestinationOpen('wiki');
    acknowledgeKnowledgeDestinationOpen('contacts');
    acknowledgeKnowledgeDestinationOpen('servers');
    surfaceMocks.wikiShouldThrow = false;
    surfaceMocks.session = { state: 'inactive', capabilities: [] };
    globalThis.api = undefined;
    vi.restoreAllMocks();
  });

  it("offers Home's Add PDF Guides only to Wiki publishers and opens the Wiki's upload", async () => {
    const { unmount } = renderWorkspace();
    expect(screen.queryByRole('button', { name: 'Add PDF Guides' })).not.toBeInTheDocument();
    unmount();

    surfaceMocks.session = { state: 'active', capabilities: ['knowledge.manage'] };
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Add PDF Guides' }));

    const wiki = await screen.findByTestId('wiki-surface');
    expect(wiki).toHaveAttribute('data-add-guides-request', '1');
    expect(visiblePanel()).toContainElement(wiki);
  });

  it('loads the Wiki count on Home without mounting the heavy Wiki surface', async () => {
    renderWorkspace();

    expect(screen.getByTestId('knowledge-home')).toBeInTheDocument();
    expect(screen.getByText('wiki count loading')).toBeInTheDocument();
    expect(await screen.findByText('7 wiki documents')).toBeInTheDocument();
    expect(screen.getByText('1 contacts')).toBeInTheDocument();
    expect(screen.getByText('1 servers')).toBeInTheDocument();
    expect(visiblePanel()).toHaveAttribute('data-destination', 'home');
    expect(screen.queryByTestId('wiki-surface')).not.toBeInTheDocument();
  });

  it('offers a lightweight retry when the Wiki count read fails', async () => {
    getKnowledgeIndexStatus
      .mockRejectedValueOnce(new Error('index status unavailable'))
      .mockResolvedValueOnce({
        state: 'idle',
        documentCount: 5,
        categoryCount: 2,
        lastIndexedAt: '2026-09-04T12:00:00.000Z',
      });
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Wiki Count' }));

    expect(await screen.findByText('5 wiki documents')).toBeInTheDocument();
    expect(getKnowledgeIndexStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('wiki-surface')).not.toBeInTheDocument();
  });

  it('keeps the Home count current from lightweight index status events', async () => {
    renderWorkspace();
    await screen.findByText('7 wiki documents');

    act(() => {
      knowledgeStatusListener?.({
        state: 'idle',
        documentCount: 9,
        categoryCount: 3,
        lastIndexedAt: '2026-09-04T12:05:00.000Z',
      });
    });

    expect(screen.getByText('9 wiki documents')).toBeInTheDocument();
  });

  it('treats resolved server errors and error events as unavailable counts', async () => {
    const unavailable = {
      state: 'error' as const,
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    };
    getKnowledgeIndexStatus.mockResolvedValueOnce(unavailable);
    renderWorkspace();
    expect(await screen.findByRole('button', { name: 'Retry Wiki Count' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Wiki Count' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry Wiki Count' })).not.toBeInTheDocument(),
    );
    act(() => knowledgeStatusListener?.(unavailable));
    expect(screen.getByRole('button', { name: 'Retry Wiki Count' })).toBeVisible();
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

  it('derives launcher quick facts from the records already loaded', () => {
    renderWorkspace();

    expect(screen.getByText('contacts Saved groups: 1')).toBeInTheDocument();
    expect(screen.getByText('contacts With phone: 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('servers Business areas: 1')).toBeInTheDocument();
    expect(screen.getByText('servers Without owner: 1')).toBeInTheDocument();
  });

  it.each([
    ['Open Contacts', 'Contacts', 'People and teams'],
    ['Open Servers', 'Servers', 'Owners and support'],
  ] as const)(
    'gives %s a single page heading and scope subtitle without an eyebrow',
    (buttonName, title, subtitle) => {
      renderWorkspace();
      fireEvent.click(screen.getByRole('button', { name: buttonName }));

      const heading = within(visiblePanel() as HTMLElement).getByRole('heading', {
        level: 1,
        name: title,
      });
      expect(heading).toHaveClass('tab-page-header__title');
      const header = heading.closest('.tab-page-header');
      expect(header).toHaveTextContent(title);
      expect(header?.querySelector('.tab-page-header__subtitle')).toHaveTextContent(subtitle);
      expect(header).not.toHaveTextContent('Knowledge');
    },
  );

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

  it('retains Wiki state but marks its heavy reader inactive outside Wiki', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    expect(await screen.findByTestId('wiki-surface')).toBeInTheDocument();
    expect(surfaceMocks.wikiEffectStarted).toHaveBeenCalledOnce();
    expect(surfaceMocks.wikiEffectCleanedUp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(await screen.findByTestId('contacts-surface')).toBeInTheDocument();
    expect(screen.getByTestId('wiki-surface')).toHaveAttribute('data-active', 'false');
    expect(surfaceMocks.wikiEffectCleanedUp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Wiki' }));
    expect(await screen.findByTestId('wiki-surface')).toBeInTheDocument();
    expect(screen.getByTestId('wiki-surface')).toHaveAttribute('data-active', 'true');
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

  it('gives Home and Wiki the shared live StatusBar, outside the Wiki error boundary', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    surfaceMocks.wikiShouldThrow = true;
    renderWorkspace();

    const homePanel = visiblePanel() as HTMLElement;
    expect(within(homePanel).getByTestId('status-bar')).toHaveTextContent('live connection');

    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    expect(await screen.findByRole('heading', { name: 'Wiki unavailable' })).toBeInTheDocument();
    const wikiPanel = visiblePanel() as HTMLElement;
    expect(wikiPanel).toHaveAttribute('data-destination', 'wiki');
    expect(within(wikiPanel).getByTestId('status-bar')).toHaveTextContent('live connection');

    consoleError.mockRestore();
  });

  it('shows the live Wiki count on Home after the Wiki snapshot loads', async () => {
    renderWorkspace();
    expect(await screen.findByText('7 wiki documents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish Wiki count' }));
    fireEvent.click(screen.getByRole('button', { name: /Knowledge Home/ }));

    expect(screen.getByText('3 wiki documents')).toBeInTheDocument();
  });

  it('keeps the Wiki library count when an older index-status read resolves afterwards', async () => {
    let resolveStatus!: (status: unknown) => void;
    const status = new Promise((resolve) => {
      resolveStatus = resolve;
    });
    getKnowledgeIndexStatus.mockReturnValueOnce(status);
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: 'Open Wiki' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish Wiki count' }));
    fireEvent.click(screen.getByRole('button', { name: /Knowledge Home/ }));
    await act(async () => {
      resolveStatus({
        state: 'idle',
        documentCount: 7,
        categoryCount: 2,
        lastIndexedAt: '2026-09-04T12:00:00.000Z',
      });
      await status;
    });

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

  it('forwards only the matching exact-record request and missing-record callback', async () => {
    const request: KnowledgeRecordOpenRequest = {
      requestId: 9,
      destination: 'contacts',
      recordKey: 'id:contact_1',
    };
    const onRecordUnavailable = vi.fn();
    render(
      <KnowledgeWorkspace
        active
        contacts={contacts}
        groups={groups}
        servers={servers}
        relayMode="server"
        onAddToAssembler={vi.fn()}
        recordOpenRequest={request}
        onRecordUnavailable={onRecordUnavailable}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Contacts' }));
    expect(await screen.findByTestId('contacts-selection-request')).toHaveTextContent(
      'id:contact_1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report missing contact' }));
    expect(onRecordUnavailable).toHaveBeenCalledWith(request);

    fireEvent.click(screen.getByRole('button', { name: 'Servers' }));
    expect(await screen.findByTestId('servers-selection-request')).toHaveTextContent(
      'no server request',
    );
  });
});
