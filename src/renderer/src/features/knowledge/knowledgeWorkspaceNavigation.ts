import { TAB_NAMES, type TabName } from '@shared/ipc';

export type KnowledgeDestination = 'home' | 'wiki' | 'contacts' | 'servers';

export const OPEN_KNOWLEDGE_DESTINATION_EVENT = 'relay:open-knowledge-destination';

type KnowledgeContentDestination = Exclude<KnowledgeDestination, 'home'>;

const knowledgeContentDestinations = new Set<KnowledgeContentDestination>([
  'wiki',
  'contacts',
  'servers',
]);

export function requestKnowledgeDestinationOpen(destination: KnowledgeContentDestination): void {
  if (!knowledgeContentDestinations.has(destination)) return;
  globalThis.dispatchEvent(
    new CustomEvent<KnowledgeContentDestination>(OPEN_KNOWLEDGE_DESTINATION_EVENT, {
      detail: destination,
    }),
  );
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
