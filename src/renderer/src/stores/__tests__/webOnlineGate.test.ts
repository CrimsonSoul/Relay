import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWebMutationGateReady, registerWebCollectionGate } from '../webOnlineGate';

const GRACE_MS = 15_000;

describe('webOnlineGate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds writes closed until a registered collection reports its first snapshot', () => {
    const gate = registerWebCollectionGate();

    expect(isWebMutationGateReady()).toBe(false);
    gate.markReady();
    expect(isWebMutationGateReady()).toBe(true);

    gate.unregister();
  });

  it('stops rejecting every write when one collection never reaches a first snapshot', () => {
    vi.useFakeTimers();
    const healthy = registerWebCollectionGate();
    const neverReady = registerWebCollectionGate();
    healthy.markReady();

    expect(isWebMutationGateReady()).toBe(false);
    // A collection missing on an older server fails its fetch, is never marked ready, and is
    // never retried. It must not block saving across the whole app for the rest of the session.
    vi.advanceTimersByTime(GRACE_MS);

    expect(isWebMutationGateReady()).toBe(true);

    healthy.unregister();
    neverReady.unregister();
  });

  it('reopens the grace window when a ready collection disconnects again', () => {
    vi.useFakeTimers();
    const gate = registerWebCollectionGate();
    gate.markReady();
    vi.advanceTimersByTime(GRACE_MS);

    gate.markDisconnected();

    expect(isWebMutationGateReady()).toBe(false);
    gate.unregister();
  });
});
