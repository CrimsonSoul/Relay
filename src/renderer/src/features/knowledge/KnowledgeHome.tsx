import { useCallback, type MouseEvent } from 'react';
import { TabPageHeader } from '../../components/tab-chrome/TabChrome';
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
  openLabel: string;
  mark: string;
};

type DestinationPanelProps = Readonly<
  DestinationDefinition & {
    count: number | null;
    onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  }
>;

const DESTINATIONS: readonly DestinationDefinition[] = [
  {
    id: 'wiki',
    title: 'Wiki',
    noun: 'document',
    description:
      'Read operational runbooks, incident guidance, recovery procedures, and reference PDFs.',
    openLabel: 'Open wiki',
    mark: 'WK',
  },
  {
    id: 'contacts',
    title: 'Contacts',
    noun: 'contact',
    description:
      'Find contact details, ownership relationships, and the right person to add to a bridge.',
    openLabel: 'Open directory',
    mark: 'CT',
  },
  {
    id: 'servers',
    title: 'Servers',
    noun: 'server',
    description:
      'Look up platform ownership, support contacts, operating systems, and business context.',
    openLabel: 'Open inventory',
    mark: 'SV',
  },
];

function formatCount(count: number | null, noun: string): string {
  if (count === null) {
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} count unavailable`;
  }
  const countNoun = count === 1 ? noun : `${noun}s`;
  return `${count} ${countNoun}`;
}

function formatHeaderCount(count: number | null, noun: string, qualifier = ''): string {
  if (count === null) {
    const label = (qualifier || noun).trim();
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} count unavailable`;
  }
  const countNoun = count === 1 ? noun : `${noun}s`;
  return `${count} ${qualifier}${countNoun}`;
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
  openLabel,
  count,
  mark,
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
          {mark}
        </span>
        <span className="knowledge-home__destination-title">{title}</span>
      </span>
      <span className="knowledge-home__destination-description">{description}</span>
      <span className="knowledge-home__destination-meta">
        <span>{countLabel}</span>
        <span>{openLabel} →</span>
      </span>
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
        KnowledgeHomeDestination | undefined;
      if (destination) onOpen(destination);
    },
    [onOpen],
  );
  const countSummary = [
    formatHeaderCount(wikiCount, 'document', 'Wiki '),
    formatHeaderCount(contactCount, 'contact'),
    formatHeaderCount(serverCount, 'server'),
  ].join(' · ');

  return (
    <section className="knowledge-home" aria-labelledby="knowledge-home-title">
      <TabPageHeader
        context="Knowledge"
        title="Knowledge"
        headingId="knowledge-home-title"
        headingLevel={1}
        metadata={<span role="status">{countSummary}</span>}
      />

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
