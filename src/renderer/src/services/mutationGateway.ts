import type { OfflineMutationInput, OfflineWritableCollection } from '@shared/ipc';
import { applyOfflineMutationToStores } from '../stores/collectionStoreRegistry';
import { isWebMutationGateReady } from '../stores/webOnlineGate';
import { getConnectionState, getPb, handleApiError, requireOnline } from './pocketbase';

async function mutateOnline<T>(
  collection: OfflineWritableCollection,
  action: 'create' | 'update' | 'delete',
  recordId: string | undefined,
  data: Record<string, unknown>,
): Promise<T | void> {
  requireOnline();
  try {
    if (action === 'create') return await getPb().collection(collection).create<T>(data);
    if (!recordId) throw new Error('A record ID is required');
    if (action === 'update') return await getPb().collection(collection).update<T>(recordId, data);
    await getPb().collection(collection).delete(recordId);
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

async function mutateOffline<T>(input: OfflineMutationInput): Promise<T | void> {
  const mutate = globalThis.api?.mutateOffline;
  if (!mutate) throw new Error('Offline storage is unavailable on this workstation.');
  const result = await mutate(input);
  if (!result.ok) throw new Error(result.error);
  applyOfflineMutationToStores(result);
  return input.action === 'delete' ? undefined : (result.record as T);
}

export async function mutateCollection<T>(
  collection: OfflineWritableCollection,
  action: 'create' | 'update' | 'delete',
  recordId: string | undefined,
  data: Record<string, unknown> = {},
): Promise<T | void> {
  const connectionState = getConnectionState();
  if (connectionState === 'auth-failed') {
    throw new Error(
      'Sign-in to the Relay server failed. Update the passphrase before saving changes.',
    );
  }

  if (connectionState !== 'online' && connectionState !== 'offline') {
    throw new Error(
      'Relay is reconnecting. Wait for the connection state to settle before saving.',
    );
  }

  if (connectionState === 'online') {
    if (globalThis.api?.runtime?.kind === 'web' && !isWebMutationGateReady()) {
      throw new Error(
        'Relay Web is finishing its authoritative refresh. Wait a moment before saving.',
      );
    }
    return mutateOnline<T>(collection, action, recordId, data);
  }

  if (globalThis.api?.runtime?.kind === 'web') {
    throw new Error('Web access requires an online connection before saving changes.');
  }

  const input: OfflineMutationInput = {
    collection,
    action,
    ...(recordId ? { recordId } : {}),
    ...(action === 'delete' ? {} : { data }),
  };
  return mutateOffline<T>(input);
}
