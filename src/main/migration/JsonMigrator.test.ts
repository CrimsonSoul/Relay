import { describe, it, expect, vi } from 'vitest';
import { JsonMigrator } from './JsonMigrator';

vi.mock('../logger', () => ({
  loggers: {
    migration: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const mockPb = { collection: vi.fn() } as any;

describe('JsonMigrator', () => {
  it('transforms contact — strips id, createdAt, updatedAt', () => {
    const migrator = new JsonMigrator(mockPb);
    const result = migrator.transformContact({
      id: 'contact-1',
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555-0100',
      title: 'Engineer',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    expect(result).toEqual({
      name: 'Alice',
      email: 'alice@example.com',
      phone: '555-0100',
      title: 'Engineer',
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('createdAt');
  });

  it('flattens notes into individual records', () => {
    const migrator = new JsonMigrator(mockPb);
    const notes = {
      contacts: { 'alice@example.com': { note: 'Great', tags: ['team'], updatedAt: 123 } },
      servers: { 'web-01': { note: 'Primary', tags: ['prod'], updatedAt: 456 } },
    };
    const result = migrator.transformNotes(notes);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      entityType: 'contact',
      entityKey: 'alice@example.com',
      note: 'Great',
      tags: ['team'],
    });
    expect(result[1]).toEqual({
      entityType: 'server',
      entityKey: 'web-01',
      note: 'Primary',
      tags: ['prod'],
    });
  });

  it('generates sortOrder for oncall based on array position', () => {
    const migrator = new JsonMigrator(mockPb);
    const records = [
      {
        id: 'oc-1',
        team: 'NOC',
        name: 'Alice',
        role: 'Lead',
        contact: '',
        timeWindow: '',
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: 'oc-2',
        team: 'NOC',
        name: 'Bob',
        role: 'Backup',
        contact: '',
        timeWindow: '',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const result = migrator.transformOnCall(records);
    expect(result[0].sortOrder).toBe(0);
    expect(result[1].sortOrder).toBe(1);
  });

  it('hasLegacyData returns false for non-existent directory', () => {
    const result = JsonMigrator.hasLegacyData('/non-existent-dir-that-does-not-exist');
    expect(result).toBe(false);
  });
});
