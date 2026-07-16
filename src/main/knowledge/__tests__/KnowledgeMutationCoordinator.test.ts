import { describe, expect, it, vi } from 'vitest';
import { KnowledgeMutationCoordinator } from '../KnowledgeMutationCoordinator';

describe('KnowledgeMutationCoordinator', () => {
  it('coalesces concurrent retries for the same request', async () => {
    const coordinator = new KnowledgeMutationCoordinator();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mutate = vi.fn(async () => {
      await pending;
      return { id: 'document-1' };
    });

    const first = coordinator.run({ requestId: 'request-1', action: 'published', mutate });
    const retry = coordinator.run({ requestId: 'request-1', action: 'published', mutate });
    release?.();

    await expect(Promise.all([first, retry])).resolves.toEqual([
      { id: 'document-1' },
      { id: 'document-1' },
    ]);
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not coalesce unrelated request identifiers', async () => {
    const coordinator = new KnowledgeMutationCoordinator();
    const mutate = vi.fn(async () => 'done');

    await Promise.all([
      coordinator.run({ requestId: 'request-1', action: 'published', mutate }),
      coordinator.run({ requestId: 'request-2', action: 'published', mutate }),
    ]);

    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
