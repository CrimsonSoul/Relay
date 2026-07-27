// A collection that never reaches its first authoritative snapshot (missing on an older server,
// permanently failing filter) has no retry and never marks itself ready. Blocking on it forever
// rejected every write app-wide, so a gate stops holding the mutation gate closed once it has
// been unready for longer than a first fetch can plausibly take.
const WEB_COLLECTION_GATE_GRACE_MS = 15_000;

type CollectionGateState = { ready: boolean; blockingSince: number };

const collectionReadiness = new Map<symbol, CollectionGateState>();

export type WebCollectionGate = {
  markDisconnected: () => void;
  markReady: () => void;
  unregister: () => void;
};

export function registerWebCollectionGate(): WebCollectionGate {
  const id = Symbol('web-collection');
  const block = () => collectionReadiness.set(id, { ready: false, blockingSince: Date.now() });
  block();
  return {
    markDisconnected: block,
    markReady: () => collectionReadiness.set(id, { ready: true, blockingSince: 0 }),
    unregister: () => collectionReadiness.delete(id),
  };
}

export function isWebMutationGateReady(): boolean {
  const staleBefore = Date.now() - WEB_COLLECTION_GATE_GRACE_MS;
  return [...collectionReadiness.values()].every(
    (gate) => gate.ready || gate.blockingSince <= staleBefore,
  );
}
