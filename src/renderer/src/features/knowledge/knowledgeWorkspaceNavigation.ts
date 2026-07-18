import { TAB_NAMES, type TabName } from '@shared/ipc';

export type KnowledgeDestination = 'home' | 'wiki' | 'contacts' | 'servers';

export const OPEN_KNOWLEDGE_DESTINATION_EVENT = 'relay:open-knowledge-destination';

export type KnowledgeContentDestination = Exclude<KnowledgeDestination, 'home'>;

const knowledgeContentDestinations = new Set<KnowledgeContentDestination>([
  'wiki',
  'contacts',
  'servers',
]);

let pendingDestination: KnowledgeContentDestination | null = null;

export function isKnowledgeContentDestination(
  value: unknown,
): value is KnowledgeContentDestination {
  return (
    typeof value === 'string' &&
    knowledgeContentDestinations.has(value as KnowledgeContentDestination)
  );
}

export function requestKnowledgeDestinationOpen(destination: KnowledgeContentDestination): void {
  if (!isKnowledgeContentDestination(destination)) return;
  pendingDestination = destination;
  globalThis.dispatchEvent(
    new CustomEvent<KnowledgeContentDestination>(OPEN_KNOWLEDGE_DESTINATION_EVENT, {
      detail: destination,
    }),
  );
}

export function getPendingKnowledgeDestinationOpen(): KnowledgeContentDestination | null {
  return pendingDestination;
}

export function acknowledgeKnowledgeDestinationOpen(
  destination: KnowledgeContentDestination,
): void {
  if (pendingDestination === destination) pendingDestination = null;
}

export function normalizeLegacyTabRequest(value: string): {
  tab: TabName;
  knowledgeDestination?: KnowledgeContentDestination;
} {
  const normalizedValue = value.trim();

  if (normalizedValue === 'People') {
    return { tab: 'Knowledge', knowledgeDestination: 'contacts' };
  }
  if (normalizedValue === 'Servers') {
    return { tab: 'Knowledge', knowledgeDestination: 'servers' };
  }
  if (normalizedValue === 'Notes') return { tab: 'Compose' };
  if ((TAB_NAMES as readonly string[]).includes(normalizedValue)) {
    return { tab: normalizedValue as TabName };
  }
  return { tab: 'Compose' };
}
