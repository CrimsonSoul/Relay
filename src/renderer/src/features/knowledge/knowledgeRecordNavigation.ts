import type { Contact, Server } from '@shared/ipc';

export type KnowledgeRecordDestination = 'contacts' | 'servers';

export type KnowledgeRecordTarget = {
  destination: KnowledgeRecordDestination;
  recordKey: string;
};

export type KnowledgeRecordOpenRequest = KnowledgeRecordTarget & {
  requestId: number;
};

export function contactRecordKey(contact: Contact): string {
  const id = contact.raw.id?.trim();
  return id ? `id:${id}` : `email:${contact.email.trim().toLowerCase()}`;
}

export function serverRecordKey(server: Server): string {
  const id = server.raw.id?.trim();
  return id ? `id:${id}` : `name:${server.name.trim().toLowerCase()}`;
}
