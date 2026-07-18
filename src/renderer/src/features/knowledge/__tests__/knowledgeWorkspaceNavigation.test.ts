import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeLegacyTabRequest,
  OPEN_KNOWLEDGE_DESTINATION_EVENT,
  requestKnowledgeDestinationOpen,
} from '../knowledgeWorkspaceNavigation';

describe('knowledge workspace navigation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
