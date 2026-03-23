import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonMigrator } from './JsonMigrator';

vi.mock('../logger', () => ({
  loggers: {
    migration: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePb(overrides: Record<string, unknown> = {}) {
  const collectionApi = {
    getFullList: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 'new-id' }),
    ...overrides,
  };
  return {
    collection: vi.fn().mockReturnValue(collectionApi),
  } as unknown as import('pocketbase').default;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const mockPb = { collection: vi.fn() } as unknown as import('pocketbase').default;

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

  // --- New tests ---

  describe('transformServer', () => {
    it('strips id, createdAt, updatedAt and maps all fields', () => {
      const migrator = new JsonMigrator(mockPb);
      const result = migrator.transformServer({
        id: 'srv-1',
        name: 'web-01',
        businessArea: 'Infra',
        lob: 'NOC',
        comment: 'primary',
        owner: 'alice',
        contact: 'alice@example.com',
        os: 'Linux',
        createdAt: 1000,
        updatedAt: 2000,
      });
      expect(result).toEqual({
        name: 'web-01',
        businessArea: 'Infra',
        lob: 'NOC',
        comment: 'primary',
        owner: 'alice',
        contact: 'alice@example.com',
        os: 'Linux',
      });
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('updatedAt');
    });
  });

  describe('transformOnCall', () => {
    it('maps all fields and uses empty string for missing timeWindow', () => {
      const migrator = new JsonMigrator(mockPb);
      const result = migrator.transformOnCall([
        {
          id: 'oc-1',
          team: 'NOC',
          role: 'Lead',
          name: 'Carol',
          contact: 'carol@example.com',
          createdAt: 0,
          updatedAt: 0,
          // timeWindow deliberately omitted
        } as never,
      ]);
      expect(result[0]).toMatchObject({
        team: 'NOC',
        role: 'Lead',
        name: 'Carol',
        contact: 'carol@example.com',
        timeWindow: '',
        sortOrder: 0,
      });
    });

    it('preserves provided timeWindow value', () => {
      const migrator = new JsonMigrator(mockPb);
      const result = migrator.transformOnCall([
        {
          id: 'oc-1',
          team: 'NOC',
          role: 'Backup',
          name: 'Dave',
          contact: '',
          timeWindow: '08:00-17:00',
          createdAt: 0,
          updatedAt: 0,
        },
      ]);
      expect(result[0].timeWindow).toBe('08:00-17:00');
    });
  });

  describe('transformNotes', () => {
    it('returns empty array when notes is empty', () => {
      const migrator = new JsonMigrator(mockPb);
      expect(migrator.transformNotes({ contacts: {}, servers: {} })).toEqual([]);
    });

    it('handles only contacts', () => {
      const migrator = new JsonMigrator(mockPb);
      const result = migrator.transformNotes({
        contacts: { 'a@b.com': { note: 'n', tags: [], updatedAt: 1 } },
        servers: {},
      });
      expect(result).toHaveLength(1);
      expect(result[0].entityType).toBe('contact');
    });

    it('handles only servers', () => {
      const migrator = new JsonMigrator(mockPb);
      const result = migrator.transformNotes({
        contacts: {},
        servers: { 'web-01': { note: 'n', tags: ['prod'], updatedAt: 1 } },
      });
      expect(result).toHaveLength(1);
      expect(result[0].entityType).toBe('server');
    });
  });

  describe('hasLegacyData', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'relay-migration-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns true when contacts.json exists', () => {
      writeFileSync(join(tempDir, 'contacts.json'), '[]');
      expect(JsonMigrator.hasLegacyData(tempDir)).toBe(true);
    });

    it('returns true when servers.json exists', () => {
      writeFileSync(join(tempDir, 'servers.json'), '[]');
      expect(JsonMigrator.hasLegacyData(tempDir)).toBe(true);
    });

    it('returns true when oncall.json exists', () => {
      writeFileSync(join(tempDir, 'oncall.json'), '[]');
      expect(JsonMigrator.hasLegacyData(tempDir)).toBe(true);
    });

    it('returns true when bridgeGroups.json exists', () => {
      writeFileSync(join(tempDir, 'bridgeGroups.json'), '[]');
      expect(JsonMigrator.hasLegacyData(tempDir)).toBe(true);
    });

    it('returns true when notes.json exists', () => {
      writeFileSync(join(tempDir, 'notes.json'), JSON.stringify({ contacts: {}, servers: {} }));
      expect(JsonMigrator.hasLegacyData(tempDir)).toBe(true);
    });

    it('returns false when none of the key files exist', () => {
      expect(JsonMigrator.hasLegacyData(tempDir)).toBe(false);
    });
  });

  describe('migrate', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'relay-migration-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates a backup directory before migrating', async () => {
      writeFileSync(join(tempDir, 'contacts.json'), JSON.stringify([]));
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      await migrator.migrate(tempDir);
      expect(existsSync(join(tempDir, 'pre-migration-backup'))).toBe(true);
    });

    it('backs up existing JSON files to pre-migration-backup', async () => {
      writeFileSync(join(tempDir, 'contacts.json'), JSON.stringify([]));
      writeFileSync(join(tempDir, 'servers.json'), JSON.stringify([]));
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      await migrator.migrate(tempDir);
      expect(existsSync(join(tempDir, 'pre-migration-backup', 'contacts.json'))).toBe(true);
      expect(existsSync(join(tempDir, 'pre-migration-backup', 'servers.json'))).toBe(true);
    });

    it('renames migrated files to <file>.migrated', async () => {
      writeFileSync(join(tempDir, 'contacts.json'), JSON.stringify([]));
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      await migrator.migrate(tempDir);
      expect(existsSync(join(tempDir, 'contacts.json'))).toBe(false);
      expect(existsSync(join(tempDir, 'contacts.json.migrated'))).toBe(true);
    });

    it('returns success:true and summary when no errors', async () => {
      writeFileSync(
        join(tempDir, 'contacts.json'),
        JSON.stringify([
          {
            id: 'c1',
            name: 'Alice',
            email: 'a@b.com',
            phone: '',
            title: '',
            createdAt: 0,
            updatedAt: 0,
          },
        ]),
      );
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      expect(result.success).toBe(true);
      expect(result.summary.contacts).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('skips collections whose JSON file does not exist', async () => {
      // No files written — backup dir should still be created, summary empty
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      expect(result.success).toBe(true);
      expect(Object.keys(result.summary)).toHaveLength(0);
    });

    it('returns success:false and records error when migration throws', async () => {
      writeFileSync(join(tempDir, 'contacts.json'), 'not-valid-json');
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('contacts.json');
    });

    it('continues migrating other collections after one fails', async () => {
      writeFileSync(join(tempDir, 'contacts.json'), 'BAD JSON');
      writeFileSync(join(tempDir, 'servers.json'), JSON.stringify([]));
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      // contacts failed, servers succeeded
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.summary.servers).toBe(0);
    });

    it('migrateCollection sends records in batches of 30', async () => {
      // Create 65 contacts — should require 3 Promise.all calls: 30 + 30 + 5
      const contacts = Array.from({ length: 65 }, (_, i) => ({
        id: `c${i}`,
        name: `Contact${i}`,
        email: `c${i}@example.com`,
        phone: '',
        title: '',
        createdAt: 0,
        updatedAt: 0,
      }));
      writeFileSync(join(tempDir, 'contacts.json'), JSON.stringify(contacts));

      const createFn = vi.fn().mockResolvedValue({ id: 'new-id' });
      const pb = {
        collection: vi.fn().mockReturnValue({
          getFullList: vi.fn().mockResolvedValue([]),
          delete: vi.fn().mockResolvedValue(undefined),
          create: createFn,
        }),
      } as unknown as import('pocketbase').default;

      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      expect(result.summary.contacts).toBe(65);
      expect(createFn).toHaveBeenCalledTimes(65);
    });

    it('deletes existing collection records before inserting (idempotent)', async () => {
      writeFileSync(
        join(tempDir, 'contacts.json'),
        JSON.stringify([
          { id: 'c1', name: 'Alice', email: '', phone: '', title: '', createdAt: 0, updatedAt: 0 },
        ]),
      );
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const pb = {
        collection: vi.fn().mockReturnValue({
          getFullList: vi.fn().mockResolvedValue([{ id: 'existing-1' }, { id: 'existing-2' }]),
          delete: deleteFn,
          create: vi.fn().mockResolvedValue({ id: 'new' }),
        }),
      } as unknown as import('pocketbase').default;

      const migrator = new JsonMigrator(pb);
      await migrator.migrate(tempDir);
      expect(deleteFn).toHaveBeenCalledWith('existing-1');
      expect(deleteFn).toHaveBeenCalledWith('existing-2');
    });

    it('migrateOncallLayout creates one record per team', async () => {
      const layout = {
        NOC: { x: 0, y: 0, w: 2, h: 1, static: false },
        Security: { x: 2, y: 0 },
      };
      writeFileSync(join(tempDir, 'oncall_layout.json'), JSON.stringify(layout));
      const createFn = vi.fn().mockResolvedValue({ id: 'new' });
      const pb = {
        collection: vi.fn().mockReturnValue({
          getFullList: vi.fn().mockResolvedValue([]),
          delete: vi.fn().mockResolvedValue(undefined),
          create: createFn,
        }),
      } as unknown as import('pocketbase').default;

      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      expect(result.summary.oncall_layout).toBe(2);
      expect(createFn).toHaveBeenCalledWith(
        expect.objectContaining({ team: 'NOC', x: 0, y: 0, w: 2, h: 1, isStatic: false }),
      );
      expect(createFn).toHaveBeenCalledWith(
        expect.objectContaining({ team: 'Security', x: 2, y: 0, w: 1, h: 1, isStatic: false }),
      );
    });

    it('migrateOncallLayout records error when layout JSON is invalid', async () => {
      writeFileSync(join(tempDir, 'oncall_layout.json'), 'INVALID');
      const pb = makePb();
      const migrator = new JsonMigrator(pb);
      const result = await migrator.migrate(tempDir);
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('oncall_layout.json'))).toBe(true);
    });
  });
});
