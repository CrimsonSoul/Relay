import type { Contact, Server } from '@shared/ipc';
import { describe, expect, it } from 'vitest';
import {
  contactRecordKey,
  serverRecordKey,
  type KnowledgeRecordOpenRequest,
} from '../knowledgeRecordNavigation';

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  name: 'Alex Operator',
  email: 'alex@example.com',
  phone: '',
  title: '',
  _searchString: 'alex operator alex@example.com',
  raw: {},
  ...overrides,
});

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'web-01',
  businessArea: '',
  lob: '',
  comment: '',
  owner: '',
  contact: '',
  os: '',
  _searchString: 'web-01',
  raw: {},
  ...overrides,
});

describe('knowledge record navigation', () => {
  it('prefers record IDs and falls back to normalized compatibility keys', () => {
    expect(contactRecordKey(makeContact({ raw: { id: 'contact_1' } }))).toBe('id:contact_1');
    expect(contactRecordKey(makeContact({ email: ' OPS@Example.com ', raw: {} }))).toBe(
      'email:ops@example.com',
    );
    expect(serverRecordKey(makeServer({ raw: { id: 'server_1' } }))).toBe('id:server_1');
    expect(serverRecordKey(makeServer({ name: ' WEB-01 ', raw: {} }))).toBe('name:web-01');
  });

  it('keeps destination, key, and request identity together', () => {
    const request: KnowledgeRecordOpenRequest = {
      requestId: 4,
      destination: 'servers',
      recordKey: 'id:server_1',
    };

    expect(request).toEqual({ requestId: 4, destination: 'servers', recordKey: 'id:server_1' });
  });
});
