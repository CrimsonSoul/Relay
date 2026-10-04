import {
  Activity,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BridgeGroup, Contact, PublicRelayConfig, Server } from '@shared/ipc';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { TabFallback } from '../../components/TabFallback';
import { StatusBar, StatusBarLive } from '../../components/StatusBar';
import { TabPageHeader } from '../../components/tab-chrome/TabChrome';
import { TactileButton } from '../../components/TactileButton';
import { useOptionalPrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { KnowledgeHome, type KnowledgeHomeFact } from './KnowledgeHome';
import {
  acknowledgeKnowledgeDestinationOpen,
  getPendingKnowledgeDestinationOpen,
  isKnowledgeContentDestination,
  KNOWLEDGE_SUBTITLES,
  loadLastKnowledgeDestination,
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
  persistLastKnowledgeDestination,
  type KnowledgeDestination,
} from './knowledgeWorkspaceNavigation';
import {
  getPendingKnowledgeDocumentOpen,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
} from './knowledgeNavigation';
import type { KnowledgeRecordOpenRequest } from './knowledgeRecordNavigation';
import './knowledge.css';
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
  onDestinationChange?: (destination: KnowledgeDestination) => void;
  recordOpenRequest?: KnowledgeRecordOpenRequest | null;
  onRecordUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
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

/**
 * One Knowledge destination. Contacts and Servers bring their own StatusBar (they are the shared
 * Directory and Servers tabs); Home and Wiki ask for the panel's `statusBar`, kept outside the
 * destination's error boundary so the connection readout survives a crashed surface.
 */
function WorkspacePanel({
  destination,
  activeDestination,
  retainEffects = false,
  header,
  statusBar = false,
  children,
}: Readonly<{
  destination: KnowledgeDestination;
  activeDestination: KnowledgeDestination;
  retainEffects?: boolean;
  header?: ReactNode;
  statusBar?: boolean;
  children: ReactNode;
}>) {
  const isActive = destination === activeDestination;
  const panel = (
    <section
      className="knowledge-workspace-shell__panel"
      data-knowledge-panel
      data-destination={destination}
      data-state={isActive ? 'active' : 'retained'}
      data-motion={isActive ? 'panel' : undefined}
      hidden={retainEffects && !isActive}
      inert={retainEffects && !isActive ? true : undefined}
      aria-label={destination === 'home' ? 'Knowledge home' : `${destination} workspace`}
    >
      {header}
      {children}
      {statusBar && <StatusBar left={<StatusBarLive />} />}
    </section>
  );
  if (retainEffects) return panel;
  return <Activity mode={isActive ? 'visible' : 'hidden'}>{panel}</Activity>;
}

function KnowledgeDestinationNav({
  destination,
  onOpen,
}: Readonly<{
  destination: ContentDestination;
  onOpen: (destination: KnowledgeDestination) => void;
}>) {
  return (
    <nav
      className="knowledge-workspace-shell__navigation tab-strip"
      aria-label="Knowledge destinations"
    >
      <button
        type="button"
        className="knowledge-workspace-shell__home tab-strip__tab"
        onClick={() => onOpen('home')}
        aria-label="Knowledge Home"
      >
        <span className="knowledge-workspace-shell__home-icon" aria-hidden="true">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 11 9-8 9 8" />
            <path d="M5 10v10h14V10" />
            <path d="M9 20v-6h6v6" />
          </svg>
        </span>
        <span className="knowledge-workspace-shell__home-label">
          <span className="knowledge-workspace-shell__home-context">Knowledge</span> Home
        </span>
      </button>
      <span className="knowledge-workspace-shell__navigation-divider" aria-hidden="true" />
      {CONTENT_DESTINATIONS.map(({ id, label }) => (
        <button
          type="button"
          key={id}
          className="knowledge-workspace-shell__destination tab-strip__tab"
          aria-current={destination === id ? 'page' : undefined}
          onClick={() => onOpen(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function DirectoryHeader({ title, subtitle }: Readonly<{ title: string; subtitle: string }>) {
  return (
    <TabPageHeader
      title={title}
      subtitle={subtitle}
      headingLevel={1}
      className="knowledge-workspace-shell__page-header"
    />
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
  onDestinationChange,
  recordOpenRequest,
  onRecordUnavailable,
}: KnowledgeWorkspaceProps) {
  const initialDestination: KnowledgeDestination =
    (getPendingKnowledgeDocumentOpen() && 'wiki') ||
    getPendingKnowledgeDestinationOpen() ||
    loadLastKnowledgeDestination();
  const [destination, setDestination] = useState<KnowledgeDestination>(initialDestination);
  const [mountedDestinations, setMountedDestinations] = useState(
    () => new Set<KnowledgeDestination>(['home', initialDestination]),
  );
  const [wikiCount, setWikiCount] = useState<number | null>(null);
  const [wikiCountLoading, setWikiCountLoading] = useState(true);
  const wikiCountRequestRef = useRef(0);

  const loadWikiCount = useCallback(async () => {
    const requestId = ++wikiCountRequestRef.current;
    setWikiCountLoading(true);
    const getStatus = globalThis.api?.getKnowledgeIndexStatus;
    if (!getStatus) {
      if (requestId === wikiCountRequestRef.current) setWikiCountLoading(false);
      return;
    }
    try {
      const status = await getStatus();
      if (requestId === wikiCountRequestRef.current) {
        setWikiCount(status.state === 'error' ? null : status.documentCount);
      }
    } catch {
      if (requestId === wikiCountRequestRef.current) setWikiCount(null);
    } finally {
      if (requestId === wikiCountRequestRef.current) setWikiCountLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWikiCount();
    const unsubscribe = globalThis.api?.onKnowledgeIndexStatusChanged?.((status) => {
      wikiCountRequestRef.current += 1;
      setWikiCount(status.state === 'error' ? null : status.documentCount);
      setWikiCountLoading(false);
    });
    return () => {
      wikiCountRequestRef.current += 1;
      unsubscribe?.();
    };
  }, [loadWikiCount]);

  const homeFacts = useMemo((): Partial<
    Record<ContentDestination, readonly KnowledgeHomeFact[]>
  > => {
    const withPhone = contacts.filter((contact) => contact.phone.trim()).length;
    const businessAreas = new Set(
      servers.map((server) => server.businessArea.trim()).filter(Boolean),
    ).size;
    const unowned = servers.filter((server) => !server.owner.trim()).length;
    // Zero-valued stats are omitted or restated so an empty count never dominates the launcher.
    return {
      contacts: [
        ...(groups.length > 0 ? [{ label: 'Saved groups', value: String(groups.length) }] : []),
        ...(contacts.length > 0
          ? [{ label: 'With phone', value: `${withPhone} of ${contacts.length}` }]
          : []),
      ],
      servers:
        servers.length > 0
          ? [
              ...(businessAreas > 0
                ? [{ label: 'Business areas', value: String(businessAreas) }]
                : []),
              unowned > 0
                ? { label: 'Without owner', value: String(unowned) }
                : { label: 'Ownership', value: 'All owned' },
            ]
          : [],
    };
  }, [contacts, groups, servers]);

  const handleWikiCountChange = useCallback((count: number | null) => {
    if (count !== null) {
      // The library snapshot is newer than any index-status read still in flight.
      wikiCountRequestRef.current += 1;
      setWikiCount(count);
      setWikiCountLoading(false);
    }
  }, []);

  useEffect(() => {
    persistLastKnowledgeDestination(destination);
    onDestinationChange?.(destination);
  }, [destination, onDestinationChange]);

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
  // Same capability check the empty Wiki uses before offering Add PDF Guides.
  const session = useOptionalPrivilegedAccess()?.session;
  const canManageWiki =
    session?.state === 'active' && session.capabilities.includes('knowledge.manage');
  const [addGuidesRequest, setAddGuidesRequest] = useState(0);
  const addWikiGuides = useCallback(() => {
    open('wiki');
    setAddGuidesRequest((request) => request + 1);
  }, [open]);

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
        <WorkspacePanel destination="home" activeDestination={destination} statusBar>
          <KnowledgeHome
            wikiCount={wikiCount}
            wikiCountLoading={wikiCountLoading}
            contactCount={contacts.length}
            serverCount={servers.length}
            onOpen={open}
            onRetryWikiCount={() => void loadWikiCount()}
            onAddWikiGuides={canManageWiki ? addWikiGuides : undefined}
            facts={homeFacts}
          />
        </WorkspacePanel>

        {mountedDestinations.has('wiki') && (
          <WorkspacePanel
            destination="wiki"
            activeDestination={destination}
            retainEffects
            statusBar
          >
            <DestinationBoundary label="Wiki" onHome={openHome}>
              <Suspense fallback={<TabFallback />}>
                <WikiSurface
                  active={active && destination === 'wiki'}
                  relayMode={relayMode}
                  onLibraryCountChange={handleWikiCountChange}
                  addGuidesRequest={addGuidesRequest}
                />
              </Suspense>
            </DestinationBoundary>
          </WorkspacePanel>
        )}

        {mountedDestinations.has('contacts') && (
          <WorkspacePanel
            destination="contacts"
            activeDestination={destination}
            header={<DirectoryHeader title="Contacts" subtitle={KNOWLEDGE_SUBTITLES.contacts} />}
          >
            <DestinationBoundary label="Contacts" onHome={openHome}>
              <Suspense fallback={<TabFallback />}>
                <ContactsSurface
                  contacts={contacts}
                  groups={groups}
                  servers={servers}
                  onAddToAssembler={onAddToAssembler}
                  selectionRequest={
                    recordOpenRequest?.destination === 'contacts' ? recordOpenRequest : null
                  }
                  onSelectionUnavailable={onRecordUnavailable}
                />
              </Suspense>
            </DestinationBoundary>
          </WorkspacePanel>
        )}

        {mountedDestinations.has('servers') && (
          <WorkspacePanel
            destination="servers"
            activeDestination={destination}
            header={<DirectoryHeader title="Servers" subtitle={KNOWLEDGE_SUBTITLES.servers} />}
          >
            <DestinationBoundary label="Servers" onHome={openHome}>
              <Suspense fallback={<TabFallback />}>
                <ServersSurface
                  servers={servers}
                  contacts={contacts}
                  selectionRequest={
                    recordOpenRequest?.destination === 'servers' ? recordOpenRequest : null
                  }
                  onSelectionUnavailable={onRecordUnavailable}
                />
              </Suspense>
            </DestinationBoundary>
          </WorkspacePanel>
        )}
      </div>
    </div>
  );
}
