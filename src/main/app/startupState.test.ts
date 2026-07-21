import { describe, expect, it, vi } from 'vitest';
import { createStartupStateController } from './startupState';

describe('startup state controller', () => {
  it('publishes legal transitions with monotonically increasing sequences', () => {
    const controller = createStartupStateController();
    const listener = vi.fn();
    controller.subscribe(listener);

    const generation = controller.beginGeneration();
    expect(controller.getSnapshot()).toMatchObject({
      generation,
      phase: 'launching',
      sequence: 1,
    });
    expect(controller.transition(generation, 'preparing-data')).toBe(true);
    expect(controller.transition(generation, 'ready')).toBe(true);

    expect(listener.mock.calls.map(([snapshot]) => snapshot.sequence)).toEqual([1, 2, 3]);
    expect(controller.getSnapshot()).toEqual({
      generation,
      phase: 'ready',
      sequence: 3,
      message: 'Relay is ready.',
    });
  });

  it('rejects illegal and stale transitions without notifying subscribers', () => {
    const controller = createStartupStateController();
    const listener = vi.fn();
    controller.subscribe(listener);
    const staleGeneration = controller.beginGeneration();
    const activeGeneration = controller.beginGeneration();
    listener.mockClear();

    expect(controller.transition(staleGeneration, 'preparing-data')).toBe(false);
    expect(controller.transition(activeGeneration, 'ready')).toBe(false);
    expect(controller.transition(activeGeneration, 'preparing-data')).toBe(true);
    expect(controller.transition(activeGeneration, 'launching')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh generation after a terminal state', () => {
    const controller = createStartupStateController();
    const first = controller.beginGeneration();
    controller.transition(first, 'preparing-data');
    controller.transition(first, 'failed', 'Could not prepare Relay.');

    const second = controller.beginGeneration();
    expect(second).toBe(first + 1);
    expect(controller.getSnapshot()).toMatchObject({
      generation: second,
      phase: 'launching',
      sequence: 4,
    });
  });

  it('bounds failure messages exposed to the renderer', () => {
    const controller = createStartupStateController();
    const generation = controller.beginGeneration();
    controller.transition(generation, 'failed', `  ${'x'.repeat(500)}  `);

    const snapshot = controller.getSnapshot();
    expect(snapshot.message).toHaveLength(240);
    expect(snapshot.message).not.toMatch(/^\s|\s$/);
  });

  it('unsubscribes listeners', () => {
    const controller = createStartupStateController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    unsubscribe();

    controller.beginGeneration();
    expect(listener).not.toHaveBeenCalled();
  });
});
