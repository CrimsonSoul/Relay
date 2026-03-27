import type { BridgeGroup } from '@shared/ipc';
import type { BridgeGroupRecord } from '../services/bridgeGroupService';

/** Convert a PocketBase BridgeGroupRecord to the app BridgeGroup type. */
export function toGroup(r: BridgeGroupRecord): BridgeGroup {
  return {
    id: r.id,
    name: r.name,
    contacts: r.contacts || [],
    createdAt: new Date(r.created).getTime(),
    updatedAt: new Date(r.updated).getTime(),
  };
}
