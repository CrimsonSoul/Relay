import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeKnowledgeDestinationOpen,
  getPendingKnowledgeDestinationOpen,
  KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY,
  loadLastKnowledgeDestination,
  normalizeLegacyTabRequest,
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
  persistLastKnowledgeDestination,
  requestKnowledgeDestinationOpen,
} from '../knowledgeWorkspaceNavigation';

describe('knowledge workspace navigation', () => {
  afterEach(() => {
    acknowledgeKnowledgeDestinationOpen('wiki');
    acknowledgeKnowledgeDestinationOpen('contacts');
    acknowledgeKnowledgeDestinationOpen('servers');
    vi.restoreAllMocks();
  });

  it.each(['contacts', 'servers'] as const)(
    'retains a %s request until the destination acknowledges it',
    (destination) => {
      requestKnowledgeDestinationOpen(destination);

      expect(getPendingKnowledgeDestinationOpen()).toBe(destination);
      acknowledgeKnowledgeDestinationOpen(destination === 'contacts' ? 'servers' : 'contacts');
      expect(getPendingKnowledgeDestinationOpen()).toBe(destination);
      acknowledgeKnowledgeDestinationOpen(destination);
      expect(getPendingKnowledgeDestinationOpen()).toBeNull();
    },
  );

  it('does not let an invalid request replace a valid pending destination', () => {
    requestKnowledgeDestinationOpen('contacts');
    requestKnowledgeDestinationOpen('stale-destination' as never);

    expect(getPendingKnowledgeDestinationOpen()).toBe('contacts');
  });

  it('falls back to Knowledge home when no valid destination is stored', () => {
    const storage = { getItem: vi.fn(() => 'broken'), setItem: vi.fn() };

    expect(loadLastKnowledgeDestination(storage)).toBe('home');
  });

  it('stores only content destinations and keeps explicit home from erasing the last choice', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };

    persistLastKnowledgeDestination('wiki', storage);
    persistLastKnowledgeDestination('home', storage);

    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledWith(KNOWLEDGE_LAST_DESTINATION_STORAGE_KEY, 'wiki');
  });

  it.each([
    ['People', { tab: 'Knowledge', knowledgeDestination: 'contacts' }],
    ['Servers', { tab: 'Knowledge', knowledgeDestination: 'servers' }],
    ['Notes', { tab: 'Compose' }],
  ])('maps legacy tab %s safely', (legacy, expected) => {
    expect(normalizeLegacyTabRequest(legacy)).toEqual(expected);
  });

  it('dispatches only workspace content destinations', () => {
    const openDestination = vi.fn();
    globalThis.addEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, openDestination);

    requestKnowledgeDestinationOpen('wiki');
    requestKnowledgeDestinationOpen('contacts');
    requestKnowledgeDestinationOpen('servers');
    requestKnowledgeDestinationOpen('stale-destination' as never);

    expect(openDestination).toHaveBeenCalledTimes(3);
    expect(openDestination.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
      'wiki',
      'contacts',
      'servers',
    ]);

    globalThis.removeEventListener(OPEN_KNOWLEDGE_DESTINATION_EVENT, openDestination);
  });
});
