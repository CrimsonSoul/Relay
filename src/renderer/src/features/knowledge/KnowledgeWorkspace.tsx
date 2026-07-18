import { Activity, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BridgeGroup, Contact, PublicRelayConfig, Server } from '@shared/ipc';
import { TabFallback } from '../../components/TabFallback';
import { KnowledgeHome } from './KnowledgeHome';
import {
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
  type KnowledgeDestination,
} from './knowledgeWorkspaceNavigation';
import {
  getPendingKnowledgeDocumentOpen,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
} from './knowledgeNavigation';
import './knowledgeWorkspace.css';

const WikiSurface = lazy(() =>
  import('./KnowledgeTab').then(({ KnowledgeTab }) => ({ default: KnowledgeTab })),
);
const ContactsSurface = lazy(() =>
  import('../../tabs/DirectoryTab').then(({ DirectoryTab }) => ({ default: DirectoryTab })),
);
const ServersSurface = lazy(() =>
  import('../../tabs/ServersTab').then(({ ServersTab }) => ({ default: ServersTab })),
);

export type KnowledgeWorkspaceProps = Readonly<{
  active: boolean;
  contacts: Contact[];
  groups: BridgeGroup[];
  servers: Server[];
  relayMode?: PublicRelayConfig['mode'];
  onAddToAssembler: (contact: Contact) => void;
}>;

type ContentDestination = Exclude<KnowledgeDestination, 'home'>;

const CONTENT_DESTINATIONS: ReadonlyArray<{
  id: ContentDestination;
  label: string;
}> = [
  { id: 'wiki', label: 'Wiki' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'servers', label: 'Servers' },
];

function isContentDestination(value: unknown): value is ContentDestination {
  return CONTENT_DESTINATIONS.some(({ id }) => id === value);
}

function WorkspacePanel({
  destination,
  activeDestination,
  children,
}: Readonly<{
  destination: KnowledgeDestination;
  activeDestination: KnowledgeDestination;
  children: ReactNode;
}>) {
  const isActive = destination === activeDestination;
  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <section
        className="knowledge-workspace-shell__panel"
        data-knowledge-panel
        data-destination={destination}
        data-state={isActive ? 'active' : 'retained'}
        aria-label={destination === 'home' ? 'Knowledge home' : `${destination} workspace`}
      >
        {children}
      </section>
    </Activity>
  );
}

function KnowledgeDestinationNav({
  destination,
  onOpen,
}: Readonly<{
  destination: ContentDestination;
  onOpen: (destination: KnowledgeDestination) => void;
}>) {
  return (
    <nav className="knowledge-workspace-shell__navigation" aria-label="Knowledge destinations">
      <button
        type="button"
        className="knowledge-workspace-shell__home"
        onClick={() => onOpen('home')}
        aria-label="Knowledge home"
      >
        <span aria-hidden="true">←</span>
        Knowledge
      </button>
      <span className="knowledge-workspace-shell__navigation-divider" aria-hidden="true" />
      {CONTENT_DESTINATIONS.map(({ id, label }) => (
        <button
          type="button"
          key={id}
          className="knowledge-workspace-shell__destination"
          aria-current={destination === id ? 'page' : undefined}
          onClick={() => onOpen(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

export function KnowledgeWorkspace({
  active,
  contacts,
  groups,
  servers,
  relayMode,
  onAddToAssembler,
}: KnowledgeWorkspaceProps) {
  const initialDestination: KnowledgeDestination = getPendingKnowledgeDocumentOpen()
    ? 'wiki'
    : 'home';
  const [destination, setDestination] = useState<KnowledgeDestination>(initialDestination);
  const [mountedDestinations, setMountedDestinations] = useState(
    () => new Set<KnowledgeDestination>(['home', initialDestination]),
  );

  const open = useCallback((next: KnowledgeDestination) => {
    setMountedDestinations((current) => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
    setDestination(next);
  }, []);

  useEffect(() => {
    const handleDestinationRequest = (event: Event) => {
      const requested = (event as CustomEvent<unknown>).detail;
      if (isContentDestination(requested)) open(requested);
    };
    const handleDocumentRequest = () => open('wiki');

    globalThis.addEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, handleDestinationRequest);
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleDocumentRequest);
    return () => {
      globalThis.removeEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, handleDestinationRequest);
      globalThis.removeEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleDocumentRequest);
    };
  }, [open]);

  return (
    <div className="knowledge-workspace-shell" data-active={active}>
      {destination !== 'home' && (
        <KnowledgeDestinationNav destination={destination} onOpen={open} />
      )}

      <div className="knowledge-workspace-shell__content">
        <WorkspacePanel destination="home" activeDestination={destination}>
          <KnowledgeHome
            wikiCount={null}
            contactCount={contacts.length}
            serverCount={servers.length}
            onOpen={open}
          />
        </WorkspacePanel>

        {mountedDestinations.has('wiki') && (
          <WorkspacePanel destination="wiki" activeDestination={destination}>
            <Suspense fallback={<TabFallback />}>
              <WikiSurface active={active && destination === 'wiki'} relayMode={relayMode} />
            </Suspense>
          </WorkspacePanel>
        )}

        {mountedDestinations.has('contacts') && (
          <WorkspacePanel destination="contacts" activeDestination={destination}>
            <Suspense fallback={<TabFallback />}>
              <ContactsSurface
                contacts={contacts}
                groups={groups}
                servers={servers}
                onAddToAssembler={onAddToAssembler}
              />
            </Suspense>
          </WorkspacePanel>
        )}

        {mountedDestinations.has('servers') && (
          <WorkspacePanel destination="servers" activeDestination={destination}>
            <Suspense fallback={<TabFallback />}>
              <ServersSurface servers={servers} contacts={contacts} />
            </Suspense>
          </WorkspacePanel>
        )}
      </div>
    </div>
  );
}
