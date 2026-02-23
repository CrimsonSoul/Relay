import { useMemo } from 'react';
import { Contact, Server, BridgeGroup } from '@shared/ipc';

export type ResultType = 'contact' | 'server' | 'group' | 'action';

export type SearchResult = {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  iconType: string;
  data: unknown;
};

export function useCommandSearch(
  query: string,
  contacts: Contact[],
  servers: Server[],
  groups: BridgeGroup[],
) {
  return useMemo((): SearchResult[] => {
    if (!query.trim()) {
      return [
        {
          id: 'action-compose',
          type: 'action',
          title: 'Go to Compose',
          subtitle: 'Open bridge composition',
          iconType: 'compose',
          data: { action: 'navigate', tab: 'Compose' },
        },
        {
          id: 'action-personnel',
          type: 'action',
          title: 'Go to On-Call Board',
          subtitle: 'View current on-call assignments',
          iconType: 'personnel',
          data: { action: 'navigate', tab: 'Personnel' },
        },
        {
          id: 'action-people',
          type: 'action',
          title: 'Go to People',
          subtitle: 'Search contacts directory',
          iconType: 'people',
          data: { action: 'navigate', tab: 'People' },
        },
        {
          id: 'action-weather',
          type: 'action',
          title: 'Go to Weather',
          subtitle: 'Check current conditions',
          iconType: 'weather',
          data: { action: 'navigate', tab: 'Weather' },
        },
        {
          id: 'action-create-contact',
          type: 'action',
          title: 'Create New Contact',
          subtitle: 'Add a new person to the directory',
          iconType: 'add-contact',
          data: { action: 'create-contact' },
        },
      ];
    }

    const lower = query.toLowerCase();
    const results: SearchResult[] = [];

    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(query.trim());
    const emailExists = contacts.some((c) => c.email.toLowerCase() === lower);

    if (isEmail) {
      results.push({
        id: 'action-add-manual',
        type: 'action',
        title: `Add "${query}" to Compose`,
        subtitle: 'Manually add to bridge recipients',
        iconType: 'add',
        data: { action: 'add-manual', value: query },
      });

      if (!emailExists) {
        results.push({
          id: 'action-create-contact-email',
          type: 'action',
          title: `Create Contact: ${query}`,
          subtitle: 'Add new contact with this email',
          iconType: 'add-contact',
          data: { action: 'create-contact', value: query },
        });
      }
    }

    groups.forEach((group) => {
      if (group.name.toLowerCase().includes(lower)) {
        results.push({
          id: `group-${group.id}`,
          type: 'group',
          title: group.name,
          subtitle: `${group.contacts.length} member${group.contacts.length === 1 ? '' : 's'}`,
          iconType: 'group',
          data: group,
        });
      }
    });

    contacts.forEach((contact) => {
      if (contact._searchString.includes(lower)) {
        results.push({
          id: `contact-${contact.email}`,
          type: 'contact',
          title: contact.name || contact.email,
          subtitle: contact.name ? contact.email : contact.title || undefined,
          iconType: 'contact',
          data: contact,
        });
      }
    });

    servers.forEach((server) => {
      if (server._searchString.includes(lower)) {
        results.push({
          id: `server-${server.name}`,
          type: 'server',
          title: server.name,
          subtitle: server.businessArea || server.owner || undefined,
          iconType: 'server',
          data: server,
        });
      }
    });

    return results.slice(0, 15);
  }, [query, contacts, servers, groups]);
}
