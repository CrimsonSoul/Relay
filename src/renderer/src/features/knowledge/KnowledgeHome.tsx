import { useCallback, type MouseEvent, type ReactNode } from 'react';
import { getSearchShortcutLabel } from '../../components/command-palette/searchShortcut';
import { KnowledgeIcon, PeopleIcon, ServersIcon } from '../../components/sidebar/SidebarIcons';
import { TabPageHeader } from '../../components/tab-chrome/TabChrome';
import { TactileButton } from '../../components/TactileButton';
import { useOptionalSearchContext } from '../../contexts/SearchContext';
import './knowledgeWorkspace.css';

export type KnowledgeHomeDestination = 'wiki' | 'contacts' | 'servers';

export type KnowledgeHomeProps = Readonly<{
  wikiCount: number | null;
  wikiCountLoading?: boolean;
  contactCount: number | null;
  serverCount: number | null;
  onOpen: (destination: KnowledgeHomeDestination) => void;
  onRetryWikiCount?: () => void;
  /** Present only for Wiki publishers: opens the Wiki straight into the PDF picker. */
  onAddWikiGuides?: () => void;
  facts?: Partial<Record<KnowledgeHomeDestination, readonly KnowledgeHomeFact[]>>;
}>;

export type KnowledgeHomeFact = Readonly<{ label: string; value: string }>;

type DestinationDefinition = {
  id: KnowledgeHomeDestination;
  title: string;
  noun: string;
  description: string;
  icon: ReactNode;
  staticFacts?: readonly KnowledgeHomeFact[];
};

type DestinationCardProps = Readonly<
  DestinationDefinition & {
    count: number | null;
    loading?: boolean;
    facts: readonly KnowledgeHomeFact[];
    onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
    /** The first step under an empty destination, outside the card button so both stay operable. */
    nextStep?: ReactNode;
  }
>;

const DESTINATIONS: readonly DestinationDefinition[] = [
  {
    id: 'wiki',
    title: 'Wiki',
    noun: 'document',
    description:
      'Read operational runbooks, incident guidance, recovery procedures, and reference PDFs.',
    icon: <KnowledgeIcon />,
    staticFacts: [{ label: 'Types', value: 'SOP manuals, quick guides' }],
  },
  {
    id: 'contacts',
    title: 'Contacts',
    noun: 'contact',
    description:
      'Find contact details, ownership relationships, and the right person to add to a bridge.',
    icon: <PeopleIcon />,
  },
  {
    id: 'servers',
    title: 'Servers',
    noun: 'server',
    description:
      'Look up platform ownership, support contacts, operating systems, and business context.',
    icon: <ServersIcon />,
  },
];

function formatCount(count: number | null, noun: string, loading = false): string {
  if (count === null) {
    if (loading) return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} count loading`;
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} count unavailable`;
  }
  if (count === 0) return `No ${noun}s yet`;
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

/** One launcher card: icon and name, what the area holds, its facts, then count and Open. */
function DestinationCard({
  id,
  title,
  noun,
  description,
  count,
  loading,
  icon,
  facts,
  onOpen,
  nextStep,
}: DestinationCardProps) {
  const countLabel = formatCount(count, noun, loading);
  const countIsQuiet = count === null || count === 0;

  return (
    <li className="knowledge-home__card">
      <button
        type="button"
        className="knowledge-home__destination"
        data-destination={id}
        aria-label={`Open ${title}, ${countLabel}`}
        onClick={onOpen}
      >
        <span className="knowledge-home__destination-header">
          <span className="knowledge-home__destination-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="knowledge-home__destination-title">{title}</span>
        </span>
        <span className="knowledge-home__destination-description">{description}</span>
        {facts.length > 0 && (
          <span className="knowledge-home__destination-facts">
            {facts.map((fact) => (
              <span key={fact.label} className="knowledge-home__destination-fact">
                <span className="knowledge-home__destination-fact-label">{fact.label}</span>
                <span className="knowledge-home__destination-fact-value">{fact.value}</span>
              </span>
            ))}
          </span>
        )}
        <span className="knowledge-home__destination-meta">
          <span
            className={`knowledge-home__destination-count${
              countIsQuiet ? ' knowledge-home__destination-count--quiet' : ''
            }`}
          >
            {countLabel}
          </span>
          {/* The visible command matches the start of the accessible name (WCAG 2.5.3). */}
          <span className="knowledge-home__destination-open">
            Open {title} <span aria-hidden="true">→</span>
          </span>
        </span>
      </button>
      {nextStep}
    </li>
  );
}

/**
 * The empty Wiki's next step, following the empty-state primary rule (DESIGN.md): publishers get
 * the Wiki's own task, Add PDF Guides, as the primary; readers cannot do that task, so they get
 * no primary, only a quiet secondary route to an owner in Contacts.
 */
function WikiNextStep({
  onAddGuides,
  onFindOwner,
}: Readonly<{ onAddGuides?: () => void; onFindOwner: () => void }>) {
  return (
    <div className="knowledge-home__next-step">
      <p className="knowledge-home__next-step-text">
        {onAddGuides
          ? 'Choose Add PDF Guides to stage and publish the first guides for your Relay team.'
          : 'Someone signed in with Publisher, Administrator or Owner access (Settings › Access) can add PDF guides.'}
      </p>
      {onAddGuides ? (
        <TactileButton variant="primary" size="sm" onClick={onAddGuides}>
          Add PDF Guides
        </TactileButton>
      ) : (
        <TactileButton variant="secondary" size="sm" icon={<PeopleIcon />} onClick={onFindOwner}>
          Find an Owner in Contacts
        </TactileButton>
      )}
    </div>
  );
}

export function KnowledgeHome({
  wikiCount,
  wikiCountLoading = false,
  contactCount,
  serverCount,
  onOpen,
  onRetryWikiCount,
  onAddWikiGuides,
  facts,
}: KnowledgeHomeProps) {
  const handleOpen = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const destination = event.currentTarget.dataset.destination as
        KnowledgeHomeDestination | undefined;
      if (destination) onOpen(destination);
    },
    [onOpen],
  );
  const searchContext = useOptionalSearchContext();
  const canRetryWikiCount = wikiCount === null && !wikiCountLoading && Boolean(onRetryWikiCount);
  const findOwner = useCallback(() => onOpen('contacts'), [onOpen]);

  return (
    <section className="knowledge-home" aria-labelledby="knowledge-home-title">
      {/* Each card states its own count, so the header carries no count summary. Search lives
          once, in the app header: the header points there instead of a second search field. */}
      <TabPageHeader
        title="Knowledge"
        subtitle="Wiki, contacts, servers"
        headingId="knowledge-home-title"
        headingLevel={1}
        metadata={
          searchContext || canRetryWikiCount ? (
            <span className="knowledge-home__header-meta">
              {searchContext && (
                <span className="knowledge-home__search-hint">
                  Search Relay{' '}
                  <kbd className="knowledge-home__search-shortcut">{getSearchShortcutLabel()}</kbd>{' '}
                  finds any contact, server, or Wiki page
                </span>
              )}
              {canRetryWikiCount && (
                <TactileButton variant="ghost" size="sm" onClick={onRetryWikiCount}>
                  Retry Wiki Count
                </TactileButton>
              )}
            </span>
          ) : undefined
        }
      />

      <ul className="knowledge-home__destinations" aria-label="Knowledge areas">
        {DESTINATIONS.map(({ staticFacts = [], ...destination }) => {
          const count = countForDestination(destination.id, wikiCount, contactCount, serverCount);
          // Static facts describe what a destination holds, so they wait until it holds something;
          // an empty Wiki row reads "No documents yet" rather than listing guide types it lacks.
          const describedFacts = count ? staticFacts : [];
          return (
            <DestinationCard
              key={destination.id}
              {...destination}
              facts={[...describedFacts, ...(facts?.[destination.id] ?? [])]}
              count={count}
              loading={destination.id === 'wiki' && wikiCountLoading}
              onOpen={handleOpen}
              nextStep={
                destination.id === 'wiki' && count === 0 ? (
                  <WikiNextStep onAddGuides={onAddWikiGuides} onFindOwner={findOwner} />
                ) : undefined
              }
            />
          );
        })}
      </ul>
    </section>
  );
}
