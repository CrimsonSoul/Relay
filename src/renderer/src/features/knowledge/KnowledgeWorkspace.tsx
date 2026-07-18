import { Activity, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { BridgeGroup, Contact, PublicRelayConfig, Server } from '@shared/ipc';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { TabFallback } from '../../components/TabFallback';
import { TactileButton } from '../../components/TactileButton';
import { KnowledgeHome } from './KnowledgeHome';
import {
  acknowledgeKnowledgeDestinationOpen,
  getPendingKnowledgeDestinationOpen,
  isKnowledgeContentDestination,
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

function DestinationFailure({
  label,
  onHome,
  onRetry,
}: Readonly<{
  label: string;
  onHome: () => void;
  onRetry: () => void;
}>) {
  return (
    <div className="knowledge-workspace-shell__failure" role="alert">
      <span className="knowledge-workspace-shell__failure-eyebrow">Workspace interrupted</span>
      <h2>{label} unavailable</h2>
      <p>
        This destination hit an unexpected error. Other Knowledge destinations remain available.
      </p>
      <div className="knowledge-workspace-shell__failure-actions">
        <TactileButton variant="primary" onClick={onRetry}>
          Try {label} again
        </TactileButton>
        <TactileButton variant="secondary" onClick={onHome}>
          Return to Knowledge
        </TactileButton>
      </div>
    </div>
  );
}

function DestinationBoundary({
  label,
  onHome,
  children,
}: Readonly<{
  label: string;
  onHome: () => void;
  children: ReactNode;
}>) {
  return (
    <ErrorBoundary
      fallback={(resetErrorBoundary) => (
        <DestinationFailure label={label} onHome={onHome} onRetry={resetErrorBoundary} />
      )}
    >
      {children}
    </ErrorBoundary>
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
  const initialDestination: KnowledgeDestination =
    (getPendingKnowledgeDocumentOpen() && 'wiki') || getPendingKnowledgeDestinationOpen() || 'home';
  const [destination, setDestination] = useState<KnowledgeDestination>(initialDestination);
  const [mountedDestinations, setMountedDestinations] = useState(
    () => new Set<KnowledgeDestination>(['home', initialDestination]),
  );
  const [wikiCount, setWikiCount] = useState<number | null>(null);

  const open = useCallback((next: KnowledgeDestination) => {
    setMountedDestinations((current) => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
    setDestination(next);
  }, []);
  const openHome = useCallback(() => open('home'), [open]);

  useEffect(() => {
    const handleDestinationRequest = (event: Event) => {
      const requested = (event as CustomEvent<unknown>).detail;
      if (!isKnowledgeContentDestination(requested)) return;
      open(requested);
      acknowledgeKnowledgeDestinationOpen(requested);
    };
    const handleDocumentRequest = () => open('wiki');

    globalThis.addEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, handleDestinationRequest);
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleDocumentRequest);

    const pendingDestination = getPendingKnowledgeDestinationOpen();
    if (pendingDestination) {
      if (getPendingKnowledgeDocumentOpen()) {
        open('wiki');
      } else {
        open(pendingDestination);
      }
      acknowledgeKnowledgeDestinationOpen(pendingDestination);
    }
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
            wikiCount={wikiCount}
            contactCount={contacts.length}
            serverCount={servers.length}
            onOpen={open}
          />
        </WorkspacePanel>

        {mountedDestinations.has('wiki') && (
          <WorkspacePanel destination="wiki" activeDestination={destination}>
            <DestinationBoundary label="Wiki" onHome={openHome}>
              <Suspense fallback={<TabFallback />}>
                <WikiSurface
                  active={active && destination === 'wiki'}
                  relayMode={relayMode}
                  onLibraryCountChange={setWikiCount}
                />
              </Suspense>
            </DestinationBoundary>
          </WorkspacePanel>
        )}

        {mountedDestinations.has('contacts') && (
          <WorkspacePanel destination="contacts" activeDestination={destination}>
            <DestinationBoundary label="Contacts" onHome={openHome}>
              <Suspense fallback={<TabFallback />}>
                <ContactsSurface
                  contacts={contacts}
                  groups={groups}
                  servers={servers}
                  onAddToAssembler={onAddToAssembler}
                />
              </Suspense>
            </DestinationBoundary>
          </WorkspacePanel>
        )}

        {mountedDestinations.has('servers') && (
          <WorkspacePanel destination="servers" activeDestination={destination}>
            <DestinationBoundary label="Servers" onHome={openHome}>
              <Suspense fallback={<TabFallback />}>
                <ServersSurface servers={servers} contacts={contacts} />
              </Suspense>
            </DestinationBoundary>
          </WorkspacePanel>
        )}
      </div>
    </div>
  );
}
