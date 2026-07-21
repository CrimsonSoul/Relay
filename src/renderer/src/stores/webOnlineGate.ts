const collectionReadiness = new Map<symbol, boolean>();

export type WebCollectionGate = {
  markDisconnected: () => void;
  markReady: () => void;
  unregister: () => void;
};

export function registerWebCollectionGate(): WebCollectionGate {
  const id = Symbol('web-collection');
  collectionReadiness.set(id, false);
  return {
    markDisconnected: () => collectionReadiness.set(id, false),
    markReady: () => collectionReadiness.set(id, true),
    unregister: () => collectionReadiness.delete(id),
  };
}

export function isWebMutationGateReady(): boolean {
  return [...collectionReadiness.values()].every(Boolean);
}
