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

/** Lower-cased search text for a contact, as every contact list matches it. */
export function contactSearchString(
  contact: Readonly<{ name: string; email: string; phone: string; title: string }>,
): string {
  return `${contact.name} ${contact.email} ${contact.phone} ${contact.title}`.toLowerCase();
}
