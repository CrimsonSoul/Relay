import { existsSync, readFileSync, renameSync, copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type PocketBase from 'pocketbase';
import { loggers } from '../logger';

const logger = loggers.migration;

interface LegacyContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyServer {
  id: string;
  name: string;
  businessArea: string;
  lob: string;
  comment: string;
  owner: string;
  contact: string;
  os: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyOnCall {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow?: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyNotes {
  contacts: Record<string, { note: string; tags: string[]; updatedAt: number }>;
  servers: Record<string, { note: string; tags: string[]; updatedAt: number }>;
}

export class JsonMigrator {
  constructor(private pb: PocketBase) {}

  transformContact(c: LegacyContact): Record<string, unknown> {
    return { name: c.name, email: c.email, phone: c.phone, title: c.title };
  }

  transformServer(s: LegacyServer): Record<string, unknown> {
    return {
      name: s.name,
      businessArea: s.businessArea,
      lob: s.lob,
      comment: s.comment,
      owner: s.owner,
      contact: s.contact,
      os: s.os,
    };
  }

  transformOnCall(records: LegacyOnCall[]): Array<Record<string, unknown>> {
    return records.map((r, i) => ({
      team: r.team,
      role: r.role,
      name: r.name,
      contact: r.contact,
      timeWindow: r.timeWindow || '',
      sortOrder: i,
    }));
  }

  transformNotes(notes: LegacyNotes): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    if (notes.contacts) {
      for (const [key, value] of Object.entries(notes.contacts)) {
        result.push({
          entityType: 'contact',
          entityKey: key,
          note: value.note,
          tags: value.tags,
        });
      }
    }

    if (notes.servers) {
      for (const [key, value] of Object.entries(notes.servers)) {
        result.push({
          entityType: 'server',
          entityKey: key,
          note: value.note,
          tags: value.tags,
        });
      }
    }

    return result;
  }

  async migrate(legacyDataDir: string): Promise<{
    success: boolean;
    summary: Record<string, number>;
    errors: string[];
  }> {
    const summary: Record<string, number> = {};
    const errors: string[] = [];

    // Back up all JSON files first
    const backupDir = join(legacyDataDir, 'pre-migration-backup');
    mkdirSync(backupDir, { recursive: true });

    const jsonFiles = [
      'contacts.json',
      'servers.json',
      'oncall.json',
      'bridgeGroups.json',
      'bridgeHistory.json',
      'alertHistory.json',
      'notes.json',
      'savedLocations.json',
      'oncall_layout.json',
    ];

    for (const file of jsonFiles) {
      const src = join(legacyDataDir, file);
      if (existsSync(src)) {
        copyFileSync(src, join(backupDir, file));
      }
    }

    logger.info('Legacy data backed up', { backupDir });

    // Migrate each collection
    const migrations: Array<{
      file: string;
      collection: string;
      transform: (data: unknown) => Array<Record<string, unknown>>;
    }> = [
      {
        file: 'contacts.json',
        collection: 'contacts',
        transform: (data) => (data as LegacyContact[]).map((c) => this.transformContact(c)),
      },
      {
        file: 'servers.json',
        collection: 'servers',
        transform: (data) => (data as LegacyServer[]).map((s) => this.transformServer(s)),
      },
      {
        file: 'oncall.json',
        collection: 'oncall',
        transform: (data) => this.transformOnCall(data as LegacyOnCall[]),
      },
      {
        file: 'bridgeGroups.json',
        collection: 'bridge_groups',
        transform: (data) =>
          (data as Array<{ id: string; name: string; contacts: string[] }>).map((g) => ({
            name: g.name,
            contacts: g.contacts,
          })),
      },
      {
        file: 'bridgeHistory.json',
        collection: 'bridge_history',
        transform: (data) =>
          (data as Array<Record<string, unknown>>).map(
            ({ id: _id, timestamp: _ts, ...rest }) => rest,
          ),
      },
      {
        file: 'alertHistory.json',
        collection: 'alert_history',
        transform: (data) =>
          (data as Array<Record<string, unknown>>).map(
            ({ id: _id, timestamp: _ts, ...rest }) => rest,
          ),
      },
      {
        file: 'notes.json',
        collection: 'notes',
        transform: (data) => this.transformNotes(data as LegacyNotes),
      },
      {
        file: 'savedLocations.json',
        collection: 'saved_locations',
        transform: (data) =>
          (data as Array<Record<string, unknown>>).map(
            ({ id: _id, createdAt: _ca, updatedAt: _ua, ...rest }) => rest,
          ),
      },
    ];

    for (const m of migrations) {
      await this.migrateCollection(m, legacyDataDir, summary, errors);
    }

    await this.migrateOncallLayout(legacyDataDir, summary, errors);

    return { success: errors.length === 0, summary, errors };
  }

  private async migrateCollection(
    m: {
      file: string;
      collection: string;
      transform: (data: unknown) => Array<Record<string, unknown>>;
    },
    legacyDataDir: string,
    summary: Record<string, number>,
    errors: string[],
  ): Promise<void> {
    const filePath = join(legacyDataDir, m.file);
    if (!existsSync(filePath)) return;

    try {
      const records = m.transform(JSON.parse(readFileSync(filePath, 'utf-8')));

      // Idempotent: delete existing collection data if JSON file exists (un-renamed)
      const existing = await this.pb.collection(m.collection).getFullList();
      for (const record of existing) {
        await this.pb.collection(m.collection).delete(record.id);
      }

      // Batch creates in parallel chunks for performance
      const BATCH_SIZE = 30;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((r) => this.pb.collection(m.collection).create(r)));
      }

      summary[m.collection] = records.length;
      renameSync(filePath, `${filePath}.migrated`);
      logger.info(`Migrated ${m.collection}`, { count: records.length });
    } catch (err) {
      errors.push(`Failed to migrate ${m.file}: ${err}`);
      logger.error(`Migration failed for ${m.file}`, { error: err });
    }
  }

  private async migrateOncallLayout(
    legacyDataDir: string,
    summary: Record<string, number>,
    errors: string[],
  ): Promise<void> {
    const layoutPath = join(legacyDataDir, 'oncall_layout.json');
    if (!existsSync(layoutPath)) return;

    try {
      const layout = JSON.parse(readFileSync(layoutPath, 'utf-8')) as Record<
        string,
        { x: number; y: number; w?: number; h?: number; static?: boolean }
      >;

      const existing = await this.pb.collection('oncall_layout').getFullList();
      for (const record of existing) {
        await this.pb.collection('oncall_layout').delete(record.id);
      }

      let count = 0;
      for (const [team, pos] of Object.entries(layout)) {
        await this.pb.collection('oncall_layout').create({
          team,
          x: pos.x,
          y: pos.y,
          w: pos.w || 1,
          h: pos.h || 1,
          isStatic: pos.static || false,
        });
        count++;
      }

      summary['oncall_layout'] = count;
      renameSync(layoutPath, `${layoutPath}.migrated`);
    } catch (err) {
      errors.push(`Failed to migrate oncall_layout.json: ${err}`);
    }
  }

  static hasLegacyData(legacyDataDir: string): boolean {
    const files = [
      'contacts.json',
      'servers.json',
      'oncall.json',
      'bridgeGroups.json',
      'notes.json',
    ];
    return files.some((f) => existsSync(join(legacyDataDir, f)));
  }
}
