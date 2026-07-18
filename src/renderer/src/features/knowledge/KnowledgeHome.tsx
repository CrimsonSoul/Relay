import { useCallback, type ComponentType, type MouseEvent } from 'react';
import { KnowledgeIcon, PeopleIcon, ServersIcon } from '../../components/sidebar/SidebarIcons';
import './knowledgeWorkspace.css';

export type KnowledgeHomeDestination = 'wiki' | 'contacts' | 'servers';

export type KnowledgeHomeProps = Readonly<{
  wikiCount: number | null;
  contactCount: number | null;
  serverCount: number | null;
  onOpen: (destination: KnowledgeHomeDestination) => void;
}>;

type DestinationDefinition = {
  id: KnowledgeHomeDestination;
  title: string;
  noun: string;
  description: string;
  Icon: ComponentType;
  Preview: ComponentType;
};

type DestinationPanelProps = Readonly<
  DestinationDefinition & {
    count: number | null;
    onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  }
>;

function WikiPreview() {
  return (
    <span className="knowledge-preview knowledge-preview--wiki" aria-hidden="true">
      <span className="knowledge-preview__rail">
        <span className="knowledge-preview__toolbar">
          <span>Documents</span>
          <span className="knowledge-preview__toolbar-mark">+</span>
        </span>
        <span className="knowledge-preview__section-label">Operations</span>
        <span className="knowledge-preview__document-row">Incident response</span>
        <span className="knowledge-preview__document-row knowledge-preview__document-row--active">
          Checkout runbook
        </span>
        <span className="knowledge-preview__document-row">Service recovery</span>
      </span>
      <span className="knowledge-preview__reader">
        <span className="knowledge-preview__reader-meta">Operations / Runbook</span>
        <span className="knowledge-preview__reader-title">Checkout recovery</span>
        <span className="knowledge-preview__rule knowledge-preview__rule--long" />
        <span className="knowledge-preview__rule" />
        <span className="knowledge-preview__rule knowledge-preview__rule--short" />
        <span className="knowledge-preview__reader-heading">Restore service</span>
        <span className="knowledge-preview__rule knowledge-preview__rule--long" />
        <span className="knowledge-preview__rule" />
      </span>
    </span>
  );
}

function ContactsPreview() {
  return (
    <span className="knowledge-preview knowledge-preview--contacts" aria-hidden="true">
      <span className="knowledge-preview__toolbar">
        <span>Directory</span>
        <span className="knowledge-preview__toolbar-action">Add contact</span>
      </span>
      <span className="knowledge-preview__filter-row">
        <span>Search contacts</span>
        <span>All groups</span>
      </span>
      <span className="knowledge-preview__contact-row">
        <span className="knowledge-preview__avatar">AR</span>
        <span className="knowledge-preview__identity">
          <strong>A. Rivera</strong>
          <small>Network Operations</small>
        </span>
        <span className="knowledge-preview__row-code">Primary</span>
      </span>
      <span className="knowledge-preview__contact-row knowledge-preview__contact-row--selected">
        <span className="knowledge-preview__avatar">MC</span>
        <span className="knowledge-preview__identity">
          <strong>M. Chen</strong>
          <small>Platform Support</small>
        </span>
        <span className="knowledge-preview__row-code">On-call</span>
      </span>
      <span className="knowledge-preview__contact-row">
        <span className="knowledge-preview__avatar">TS</span>
        <span className="knowledge-preview__identity">
          <strong>T. Singh</strong>
          <small>Service Delivery</small>
        </span>
        <span className="knowledge-preview__row-code">Support</span>
      </span>
    </span>
  );
}

function ServersPreview() {
  return (
    <span className="knowledge-preview knowledge-preview--servers" aria-hidden="true">
      <span className="knowledge-preview__server-list">
        <span className="knowledge-preview__toolbar">
          <span>Infrastructure</span>
          <span>3 online</span>
        </span>
        <span className="knowledge-preview__server-row knowledge-preview__server-row--selected">
          <span className="knowledge-preview__status-dot" />
          <span>
            <strong>api-prod-01</strong>
            <small>Production</small>
          </span>
        </span>
        <span className="knowledge-preview__server-row">
          <span className="knowledge-preview__status-dot" />
          <span>
            <strong>db-primary</strong>
            <small>Data Services</small>
          </span>
        </span>
        <span className="knowledge-preview__server-row">
          <span className="knowledge-preview__status-dot" />
          <span>
            <strong>edge-gateway</strong>
            <small>Network</small>
          </span>
        </span>
      </span>
      <span className="knowledge-preview__server-detail">
        <span className="knowledge-preview__server-glyph">AP</span>
        <strong>api-prod-01</strong>
        <span className="knowledge-preview__server-os">Linux</span>
        <span className="knowledge-preview__field-label">Owner</span>
        <span className="knowledge-preview__field-value">Platform Operations</span>
        <span className="knowledge-preview__field-label">Environment</span>
        <span className="knowledge-preview__field-value">Production</span>
      </span>
    </span>
  );
}

const DESTINATIONS: readonly DestinationDefinition[] = [
  {
    id: 'wiki',
    title: 'Wiki',
    noun: 'document',
    description: 'Browse operational guides and runbooks.',
    Icon: KnowledgeIcon,
    Preview: WikiPreview,
  },
  {
    id: 'contacts',
    title: 'Contacts',
    noun: 'contact',
    description: 'Find people, groups, and support details.',
    Icon: PeopleIcon,
    Preview: ContactsPreview,
  },
  {
    id: 'servers',
    title: 'Servers',
    noun: 'server',
    description: 'Inspect infrastructure ownership and status.',
    Icon: ServersIcon,
    Preview: ServersPreview,
  },
];

function formatCount(count: number | null, noun: string): string {
  if (count === null) {
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} count unavailable`;
  }
  const countNoun = count === 1 ? noun : `${noun}s`;
  return `${count} ${countNoun}`;
}

function countForDestination(
  destination: KnowledgeHomeDestination,
  wikiCount: number | null,
  contactCount: number | null,
  serverCount: number | null,
): number | null {
  if (destination === 'wiki') return wikiCount;
  if (destination === 'contacts') return contactCount;
  return serverCount;
}

function DestinationPanel({
  id,
  title,
  noun,
  description,
  count,
  Icon,
  Preview,
  onOpen,
}: DestinationPanelProps) {
  const countLabel = formatCount(count, noun);

  return (
    <button
      type="button"
      className="knowledge-home__destination"
      data-destination={id}
      aria-label={`Open ${title}, ${countLabel}`}
      onClick={onOpen}
    >
      <span className="knowledge-home__destination-header">
        <span className="knowledge-home__destination-icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="knowledge-home__destination-title">{title}</span>
        <span className="knowledge-home__destination-arrow" aria-hidden="true">
          →
        </span>
      </span>
      <span className="knowledge-home__destination-copy">
        <span>{description}</span>
        <strong>{countLabel}</strong>
      </span>
      <Preview />
      <span className="knowledge-home__open-label">Open {title}</span>
    </button>
  );
}

export function KnowledgeHome({
  wikiCount,
  contactCount,
  serverCount,
  onOpen,
}: KnowledgeHomeProps) {
  const handleOpen = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const destination = event.currentTarget.dataset.destination as
        | KnowledgeHomeDestination
        | undefined;
      if (destination) onOpen(destination);
    },
    [onOpen],
  );

  return (
    <section className="knowledge-home" aria-labelledby="knowledge-home-title">
      <header className="knowledge-home__header">
        <h1 id="knowledge-home-title">Knowledge</h1>
        <p>Select a destination.</p>
      </header>

      <div className="knowledge-home__destinations">
        {DESTINATIONS.map((destination) => {
          const count = countForDestination(destination.id, wikiCount, contactCount, serverCount);
          return (
            <DestinationPanel
              key={destination.id}
              {...destination}
              count={count}
              onOpen={handleOpen}
            />
          );
        })}
      </div>
    </section>
  );
}
