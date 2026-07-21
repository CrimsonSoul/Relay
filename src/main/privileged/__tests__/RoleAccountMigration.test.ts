import { describe, expect, it } from 'vitest';
import type PocketBase from 'pocketbase';
import { ROLE_ACCOUNT_MIGRATION_VERSION, RoleAccountMigration } from '../RoleAccountMigration';

type FakeRecord = { id: string; [key: string]: unknown };

class MigrationFixture {
  readonly records = new Map<string, FakeRecord[]>();
  readonly collectionIds = new Map<string, string>();
  readonly collectionMetadata = new Map<string, Record<string, unknown>>();
  readonly writes: Array<{ collection: string; operation: string; id?: string }> = [];
  collectionListCalls = 0;
  failNextUpdateFor: string | null = null;
  ignoreNextUpdateFor: string | null = null;
  failNextCollectionDeleteFor: string | null = null;

  readonly pb: PocketBase;

  constructor(seed: Record<string, FakeRecord[]>) {
    for (const [name, records] of Object.entries(seed)) {
      this.records.set(name, structuredClone(records));
      this.collectionIds.set(name, `${name}-collection`);
      this.collectionMetadata.set(name, {});
    }

    const collections = {
      getFullList: async () => {
        this.collectionListCalls += 1;
        return this.collectionSnapshot();
      },
      delete: async (id: string) => {
        const name = [...this.collectionIds].find(([, collectionId]) => collectionId === id)?.[0];
        if (!name) throw new Error(`Unknown collection ${id}`);
        if (this.failNextCollectionDeleteFor === name) {
          this.failNextCollectionDeleteFor = null;
          throw new Error(`Injected ${name} collection deletion failure`);
        }
        this.collectionIds.delete(name);
        this.collectionMetadata.delete(name);
        this.records.delete(name);
        this.writes.push({ collection: name, operation: 'delete-collection' });
      },
    };

    const collection = (name: string) => ({
      getList: async () => {
        const records = structuredClone(this.records.get(name) ?? []);
        return { totalItems: records.length, items: records };
      },
      getFullList: async () => structuredClone(this.records.get(name) ?? []),
      create: async (data: Record<string, unknown>) => {
        const id = this.createdId(name, data);
        const record = { id, ...structuredClone(data) };
        const records = this.records.get(name) ?? [];
        records.push(record);
        this.records.set(name, records);
        this.collectionIds.set(name, this.collectionIds.get(name) ?? `${name}-collection`);
        this.writes.push({ collection: name, operation: 'create', id });
        return structuredClone(record);
      },
      update: async (id: string, data: Record<string, unknown>) => {
        if (this.failNextUpdateFor === name) {
          this.failNextUpdateFor = null;
          throw new Error(`Injected ${name} update failure`);
        }
        const records = this.records.get(name) ?? [];
        const index = records.findIndex((record) => record.id === id);
        if (index < 0) throw new Error(`Unknown ${name} record ${id}`);
        if (this.ignoreNextUpdateFor === name) {
          this.ignoreNextUpdateFor = null;
          this.writes.push({ collection: name, operation: 'update', id });
          return { ...structuredClone(records[index]), ...structuredClone(data) };
        }
        records[index] = { ...records[index], ...structuredClone(data) };
        this.writes.push({ collection: name, operation: 'update', id });
        return structuredClone(records[index]);
      },
      delete: async (id: string) => {
        const records = this.records.get(name) ?? [];
        const index = records.findIndex((record) => record.id === id);
        if (index < 0) throw new Error(`Unknown ${name} record ${id}`);
        records.splice(index, 1);
        this.writes.push({ collection: name, operation: 'delete', id });
      },
    });

    this.pb = { collections, collection } as unknown as PocketBase;
  }

  record(collection: string, id: string): FakeRecord {
    const record = this.records.get(collection)?.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`Missing ${collection}/${id}`);
    return record;
  }

  hasCollection(name: string): boolean {
    return this.collectionIds.has(name);
  }

  collectionSnapshot(): Array<{ id: string; name: string; [key: string]: unknown }> {
    return [...this.collectionIds].map(([name, id]) => ({
      id,
      name,
      ...this.collectionMetadata.get(name),
    }));
  }

  setCollectionMetadata(name: string, metadata: Record<string, unknown>): void {
    if (!this.collectionIds.has(name)) throw new Error(`Unknown collection ${name}`);
    this.collectionMetadata.set(name, structuredClone(metadata));
  }

  private createdId(name: string, data: Record<string, unknown>): string {
    if (name === 'relay_privileged_accounts') return `account-${String(data.username)}`;
    if (name === 'relay_privileged_state') return 'privileged-state';
    return `${name}-${(this.records.get(name)?.length ?? 0) + 1}`;
  }
}

function legacyFixture(overrides: Record<string, FakeRecord[]> = {}): MigrationFixture {
  return new MigrationFixture({
    relay_operators: [
      { id: 'ryan-op', displayName: 'Ryan Bledsoe', active: true },
      { id: 'charles-op', displayName: 'Charles Gibbs', active: true },
    ],
    relay_privileged_accounts: [
      {
        id: 'account-ryan',
        operatorId: 'ryan-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 7,
        passwordHash: 'ryan-existing-hash',
      },
      {
        id: 'account-charles',
        operatorId: 'charles-op',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 4,
        passwordHash: 'charles-existing-hash',
      },
    ],
    relay_privileged_state: [
      {
        id: 'privileged-state',
        key: 'primary',
        adminOperatorId: 'ryan-op',
        adminOperatorIds: ['ryan-op', 'charles-op'],
        publisherOperatorId: '',
        assignmentVersion: 3,
      },
    ],
    relay_privileged_devices: [
      { id: 'device-ryan', accountId: 'account-ryan', deviceId: 'ryan-device' },
      { id: 'device-charles', accountId: 'account-charles', deviceId: 'charles-device' },
    ],
    ...overrides,
  });
}

function migration(fixture: MigrationFixture): RoleAccountMigration {
  return new RoleAccountMigration({
    pb: fixture.pb,
    now: () => Date.parse('2026-07-17T18:00:00.000Z'),
  });
}

describe('RoleAccountMigration', () => {
  it('uses a supplied collection snapshot without listing metadata again', async () => {
    const fixture = legacyFixture();

    await migration(fixture).run(fixture.collectionSnapshot());

    expect(fixture.collectionListCalls).toBe(0);
  });

  it('preserves Ryan and Charles auth record IDs, credentials, and device relations', async () => {
    const fixture = legacyFixture();

    await expect(migration(fixture).run()).resolves.toEqual({
      status: 'migrated',
      ownerAccountId: 'account-ryan',
      administratorAccountIds: ['account-ryan', 'account-charles'],
    });
    expect(fixture.record('relay_privileged_accounts', 'account-ryan')).toMatchObject({
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      legacyOperatorId: 'ryan-op',
      credentialVersion: 7,
      passwordHash: 'ryan-existing-hash',
    });
    expect(fixture.record('relay_privileged_accounts', 'account-charles')).toMatchObject({
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      legacyOperatorId: 'charles-op',
      credentialVersion: 4,
      passwordHash: 'charles-existing-hash',
    });
    expect(fixture.record('relay_privileged_devices', 'device-charles').accountId).toBe(
      'account-charles',
    );
    expect(fixture.record('relay_privileged_state', 'privileged-state')).toMatchObject({
      ownerAccountId: 'account-ryan',
      publisherAccountId: '',
      identityMigrationVersion: ROLE_ACCOUNT_MIGRATION_VERSION,
    });
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('retires legacy ordinary auth accounts without changing protected IDs or history', async () => {
    const fixture = legacyFixture({
      relay_privileged_accounts: [
        ...legacyFixture().records.get('relay_privileged_accounts')!,
        {
          id: 'account-ordinary',
          operatorId: 'ordinary-op',
          role: 'operator',
          active: false,
          mustChangePassword: true,
          credentialVersion: 0,
        },
      ],
      relay_operators: [
        ...legacyFixture().records.get('relay_operators')!,
        { id: 'ordinary-op', displayName: 'Ordinary Reader', active: true },
      ],
      alert_reminders: [
        {
          id: 'historical-reminder',
          operatorId: 'ordinary-op',
          createdBy: 'Preserved Reader Snapshot',
        },
      ],
    });
    const deviceBindings = structuredClone(fixture.records.get('relay_privileged_devices'));

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });

    expect(
      fixture.records
        .get('relay_privileged_accounts')
        ?.map(({ id }) => id)
        .sort(),
    ).toEqual(['account-charles', 'account-ryan']);
    expect(fixture.record('relay_privileged_accounts', 'account-ryan')).toMatchObject({
      username: 'ryan',
      storedRole: 'administrator',
    });
    expect(fixture.record('relay_privileged_accounts', 'account-charles')).toMatchObject({
      username: 'charles',
      storedRole: 'administrator',
    });
    expect(fixture.records.get('relay_privileged_devices')).toEqual(deviceBindings);
    expect(fixture.record('alert_reminders', 'historical-reminder').createdBy).toBe(
      'Preserved Reader Snapshot',
    );
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('retires the validated legacy login view before deleting its operator roster', async () => {
    const fixture = legacyFixture({ relay_login_roster: [] });
    fixture.setCollectionMetadata('relay_login_roster', {
      type: 'view',
      viewQuery: 'SELECT id, displayName FROM relay_operators WHERE active = TRUE',
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });

    expect(fixture.hasCollection('relay_login_roster')).toBe(false);
    expect(fixture.hasCollection('relay_operators')).toBe(false);
    expect(fixture.writes.filter(({ operation }) => operation === 'delete-collection')).toEqual([
      { collection: 'relay_login_roster', operation: 'delete-collection' },
      { collection: 'relay_operators', operation: 'delete-collection' },
    ]);
  });

  it('defers without writes when the legacy login view definition is unexpected', async () => {
    const fixture = legacyFixture({ relay_login_roster: [] });
    fixture.setCollectionMetadata('relay_login_roster', {
      type: 'view',
      viewQuery: 'SELECT id FROM relay_privileged_accounts',
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('login roster view'),
    });
    expect(fixture.writes).toEqual([]);
  });

  it('resumes view and roster retirement after the roster deletion fails', async () => {
    const fixture = legacyFixture({ relay_login_roster: [] });
    fixture.setCollectionMetadata('relay_login_roster', {
      type: 'view',
      viewQuery: 'SELECT id, displayName FROM relay_operators WHERE active = TRUE',
    });
    fixture.failNextCollectionDeleteFor = 'relay_operators';

    await expect(migration(fixture).run()).rejects.toThrow('Injected');
    expect(fixture.hasCollection('relay_login_roster')).toBe(false);
    expect(fixture.hasCollection('relay_operators')).toBe(true);

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('defers without writes when a retired ordinary account still owns a paired device', async () => {
    const fixture = legacyFixture({
      relay_privileged_accounts: [
        ...legacyFixture().records.get('relay_privileged_accounts')!,
        {
          id: 'account-ordinary',
          operatorId: 'ordinary-op',
          role: 'operator',
          active: false,
          mustChangePassword: true,
          credentialVersion: 0,
        },
      ],
      relay_operators: [
        ...legacyFixture().records.get('relay_operators')!,
        { id: 'ordinary-op', displayName: 'Ordinary Reader', active: true },
      ],
      relay_privileged_devices: [
        ...legacyFixture().records.get('relay_privileged_devices')!,
        { id: 'device-ordinary', accountId: 'account-ordinary', deviceId: 'ordinary-device' },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('paired device'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('preserves an existing publisher with a deterministic unique username', async () => {
    const fixture = legacyFixture({
      relay_operators: [
        { id: 'ryan-op', displayName: 'Ryan Bledsoe', active: true },
        { id: 'charles-op', displayName: 'Charles Gibbs', active: true },
        { id: 'publisher-op', displayName: 'Paris Carlson', active: true },
      ],
      relay_privileged_accounts: [
        ...legacyFixture().records.get('relay_privileged_accounts')!,
        {
          id: 'account-publisher',
          operatorId: 'publisher-op',
          role: 'publisher',
          active: true,
          mustChangePassword: false,
          credentialVersion: 2,
          passwordHash: 'paris-existing-hash',
        },
      ],
      relay_privileged_state: [
        {
          id: 'privileged-state',
          key: 'primary',
          adminOperatorId: 'ryan-op',
          adminOperatorIds: ['ryan-op', 'charles-op'],
          publisherOperatorId: 'publisher-op',
          assignmentVersion: 8,
        },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('relay_privileged_accounts', 'account-publisher')).toMatchObject({
      username: 'paris',
      displayName: 'Paris Carlson',
      storedRole: 'publisher',
      legacyOperatorId: 'publisher-op',
      active: true,
      mustChangePassword: false,
      credentialVersion: 2,
      passwordHash: 'paris-existing-hash',
    });
    expect(fixture.record('relay_privileged_state', 'privileged-state')).toMatchObject({
      publisherAccountId: 'account-publisher',
    });
  });

  it('defers without writes when the fixed Paris username is already assigned', async () => {
    const base = legacyFixture();
    const fixture = legacyFixture({
      relay_operators: [
        ...base.records.get('relay_operators')!,
        { id: 'other-admin-op', displayName: 'Other Administrator', active: true },
        { id: 'publisher-op', displayName: 'Paris Carlson', active: true },
      ],
      relay_privileged_accounts: [
        ...base.records.get('relay_privileged_accounts')!,
        {
          id: 'account-other-admin',
          operatorId: 'other-admin-op',
          role: 'admin',
          username: 'PARIS',
          active: true,
          mustChangePassword: false,
          credentialVersion: 1,
        },
        {
          id: 'account-publisher',
          operatorId: 'publisher-op',
          role: 'publisher',
          active: true,
          mustChangePassword: false,
          credentialVersion: 2,
        },
      ],
      relay_privileged_state: [
        {
          id: 'privileged-state',
          key: 'primary',
          adminOperatorId: 'ryan-op',
          adminOperatorIds: ['ryan-op', 'charles-op', 'other-admin-op'],
          publisherOperatorId: 'publisher-op',
          assignmentVersion: 8,
        },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('paris username'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('defers without writes when multiple Publisher accounts conflict with the authoritative pointer', async () => {
    const fixture = legacyFixture({
      relay_operators: [
        { id: 'ryan-op', displayName: 'Ryan Bledsoe', active: true },
        { id: 'charles-op', displayName: 'Charles Gibbs', active: true },
        { id: 'publisher-op', displayName: 'Paris Carlson', active: true },
        { id: 'stale-publisher-op', displayName: 'Stale Publisher', active: false },
      ],
      relay_privileged_accounts: [
        ...legacyFixture().records.get('relay_privileged_accounts')!,
        {
          id: 'account-publisher',
          operatorId: 'publisher-op',
          role: 'publisher',
          active: true,
          mustChangePassword: false,
          credentialVersion: 2,
        },
        {
          id: 'account-stale-publisher',
          operatorId: 'stale-publisher-op',
          role: 'publisher',
          active: false,
          mustChangePassword: true,
          credentialVersion: 3,
        },
      ],
      relay_privileged_state: [
        {
          id: 'privileged-state',
          key: 'primary',
          adminOperatorId: 'ryan-op',
          adminOperatorIds: ['ryan-op', 'charles-op'],
          publisherOperatorId: 'publisher-op',
          assignmentVersion: 8,
        },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('Publisher auth accounts'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('defers without writes when a requested username collides', async () => {
    const fixture = legacyFixture();
    fixture.records.get('relay_privileged_accounts')!.push({
      id: 'account-conflict',
      username: 'RYAN',
      operatorId: 'other-op',
      role: 'publisher',
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('username'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('defers when Ryan or Charles cannot be resolved uniquely', async () => {
    const fixture = legacyFixture();
    fixture.records.get('relay_operators')!.push({
      id: 'duplicate-ryan',
      displayName: ' Ryan   Bledsoe ',
      active: true,
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('Ryan Bledsoe'),
    });
    expect(fixture.writes).toEqual([]);
  });

  it('backfills only an empty historical name snapshot', async () => {
    const fixture = legacyFixture({
      alert_reminders: [
        { id: 'blank', operatorId: 'charles-op', createdBy: '' },
        { id: 'preserved', operatorId: 'ryan-op', createdBy: 'Original Ryan Snapshot' },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('alert_reminders', 'blank').createdBy).toBe('Charles Gibbs');
    expect(fixture.record('alert_reminders', 'preserved').createdBy).toBe('Original Ryan Snapshot');
  });

  it('never rewrites historical Knowledge attribution rows', async () => {
    const fixture = legacyFixture({
      knowledge_documents: [
        {
          id: 'legacy-document',
          publishedByOperatorId: 'charles-op',
          publishedByName: '',
        },
      ],
      knowledge_uploads: [
        {
          id: 'legacy-upload',
          operatorId: 'charles-op',
          operatorName: '',
        },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('knowledge_documents', 'legacy-document')).toEqual({
      id: 'legacy-document',
      publishedByOperatorId: 'charles-op',
      publishedByName: '',
    });
    expect(fixture.record('knowledge_uploads', 'legacy-upload')).toEqual({
      id: 'legacy-upload',
      operatorId: 'charles-op',
      operatorName: '',
    });
    expect(fixture.writes.filter(({ collection }) => collection.startsWith('knowledge_'))).toEqual(
      [],
    );
  });

  it('verifies historical backfills before committing the marker and retries them on restart', async () => {
    const fixture = legacyFixture({
      alert_reminders: [{ id: 'blank', operatorId: 'charles-op', createdBy: '' }],
    });
    fixture.ignoreNextUpdateFor = 'alert_reminders';

    await expect(migration(fixture).run()).rejects.toThrow(/historical snapshot/i);
    expect(fixture.record('alert_reminders', 'blank').createdBy).toBe('');
    expect(fixture.record('relay_privileged_state', 'privileged-state')).not.toHaveProperty(
      'identityMigrationVersion',
    );
    expect(fixture.hasCollection('relay_operators')).toBe(true);

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('alert_reminders', 'blank').createdBy).toBe('Charles Gibbs');
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('verifies account updates before committing the marker and retries them on restart', async () => {
    const fixture = legacyFixture();
    fixture.ignoreNextUpdateFor = 'relay_privileged_accounts';

    await expect(migration(fixture).run()).rejects.toThrow(/account update/i);
    expect(fixture.record('relay_privileged_accounts', 'account-charles')).not.toHaveProperty(
      'storedRole',
    );
    expect(fixture.record('relay_privileged_state', 'privileged-state')).not.toHaveProperty(
      'identityMigrationVersion',
    );
    expect(fixture.hasCollection('relay_operators')).toBe(true);

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('relay_privileged_accounts', 'account-charles')).toMatchObject({
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      legacyOperatorId: 'charles-op',
    });
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('defers an unresolvable historical attribution before making changes', async () => {
    const fixture = legacyFixture({
      alert_reminders: [{ id: 'unknown', operatorId: 'removed-op', createdBy: '' }],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('removed-op'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('repairs a historical snapshot left behind by a marker-present partial migration', async () => {
    const fixture = legacyFixture({
      relay_privileged_accounts: [
        {
          id: 'account-ryan',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          storedRole: 'administrator',
          legacyOperatorId: 'ryan-op',
        },
        {
          id: 'account-charles',
          username: 'charles',
          displayName: 'Charles Gibbs',
          storedRole: 'administrator',
          legacyOperatorId: 'charles-op',
        },
      ],
      relay_privileged_state: [
        {
          id: 'privileged-state',
          key: 'primary',
          adminOperatorId: 'ryan-op',
          adminOperatorIds: ['ryan-op', 'charles-op'],
          publisherOperatorId: '',
          ownerAccountId: 'account-ryan',
          publisherAccountId: '',
          identityMigrationVersion: ROLE_ACCOUNT_MIGRATION_VERSION,
        },
      ],
      alert_reminders: [{ id: 'blank', operatorId: 'charles-op', createdBy: '' }],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('alert_reminders', 'blank').createdBy).toBe('Charles Gibbs');
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('repairs an account left behind by a marker-present partial migration', async () => {
    const fixture = legacyFixture();
    Object.assign(fixture.record('relay_privileged_accounts', 'account-charles'), {
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      legacyOperatorId: 'charles-op',
    });
    Object.assign(fixture.record('relay_privileged_state', 'privileged-state'), {
      ownerAccountId: 'account-ryan',
      publisherAccountId: '',
      identityMigrationVersion: ROLE_ACCOUNT_MIGRATION_VERSION,
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.record('relay_privileged_accounts', 'account-ryan')).toMatchObject({
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      legacyOperatorId: 'ryan-op',
    });
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('defers marker-present recovery when a converted administrator is absent from the authoritative roster', async () => {
    const fixture = legacyFixture();
    Object.assign(fixture.record('relay_privileged_accounts', 'account-ryan'), {
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      legacyOperatorId: 'ryan-op',
    });
    Object.assign(fixture.record('relay_privileged_accounts', 'account-charles'), {
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      legacyOperatorId: 'charles-op',
    });
    fixture.records.get('relay_operators')!.push({
      id: 'stale-admin-op',
      displayName: 'Stale Administrator',
      active: true,
    });
    fixture.records.get('relay_privileged_accounts')!.push({
      id: 'account-stale-admin',
      username: 'stale.admin',
      displayName: 'Stale Administrator',
      storedRole: 'administrator',
      legacyOperatorId: 'stale-admin-op',
      active: true,
    });
    Object.assign(fixture.record('relay_privileged_state', 'privileged-state'), {
      ownerAccountId: 'account-ryan',
      publisherAccountId: '',
      identityMigrationVersion: ROLE_ACCOUNT_MIGRATION_VERSION,
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('account-stale-admin'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('defers duplicate planned usernames before making changes', async () => {
    const fixture = legacyFixture({
      relay_operators: [
        ...legacyFixture().records.get('relay_operators')!,
        { id: 'first-op', displayName: 'First Administrator', active: true },
        { id: 'second-op', displayName: 'Second Administrator', active: true },
      ],
      relay_privileged_accounts: [
        ...legacyFixture().records.get('relay_privileged_accounts')!,
        { id: 'account-first', operatorId: 'first-op', role: 'admin', username: 'shared' },
        { id: 'account-second', operatorId: 'second-op', role: 'admin', username: 'SHARED' },
      ],
      relay_privileged_state: [
        {
          id: 'privileged-state',
          key: 'primary',
          adminOperatorId: 'ryan-op',
          adminOperatorIds: ['ryan-op', 'charles-op', 'first-op', 'second-op'],
          publisherOperatorId: '',
          assignmentVersion: 3,
        },
      ],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('duplicated'),
    });
    expect(fixture.writes).toEqual([]);
  });

  it('defers when an administrator account has a non-administrator stored role', async () => {
    const fixture = legacyFixture();
    Object.assign(fixture.record('relay_privileged_accounts', 'account-charles'), {
      role: 'publisher',
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('Administrator'),
    });
    expect(fixture.writes).toEqual([]);
  });

  it('defers without writes when an active administrator account is absent from the authoritative roster', async () => {
    const fixture = legacyFixture();
    fixture.records.get('relay_operators')!.push({
      id: 'stale-admin-op',
      displayName: 'Stale Administrator',
      active: true,
    });
    fixture.records.get('relay_privileged_accounts')!.push({
      id: 'account-stale-admin',
      operatorId: 'stale-admin-op',
      role: 'admin',
      active: true,
      mustChangePassword: false,
      credentialVersion: 2,
    });
    const legacyAccounts = structuredClone(fixture.records.get('relay_privileged_accounts'));
    const legacyState = structuredClone(fixture.records.get('relay_privileged_state'));

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('account-stale-admin'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.records.get('relay_privileged_accounts')).toEqual(legacyAccounts);
    expect(fixture.records.get('relay_privileged_state')).toEqual(legacyState);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('also defers an inactive stale administrator because the legacy role remains eligible for conversion', async () => {
    const fixture = legacyFixture();
    fixture.records.get('relay_operators')!.push({
      id: 'inactive-stale-admin-op',
      displayName: 'Inactive Stale Administrator',
      active: false,
    });
    fixture.records.get('relay_privileged_accounts')!.push({
      id: 'account-inactive-stale-admin',
      operatorId: 'inactive-stale-admin-op',
      storedRole: 'administrator',
      active: false,
      mustChangePassword: false,
      credentialVersion: 1,
    });
    const legacyAccounts = structuredClone(fixture.records.get('relay_privileged_accounts'));

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('account-inactive-stale-admin'),
    });
    expect(fixture.writes).toEqual([]);
    expect(fixture.records.get('relay_privileged_accounts')).toEqual(legacyAccounts);
    expect(fixture.hasCollection('relay_operators')).toBe(true);
  });

  it('is idempotent after a successful restart', async () => {
    const fixture = legacyFixture();
    await migration(fixture).run();
    const writesAfterSuccess = fixture.writes.length;

    await expect(migration(fixture).run()).resolves.toEqual({ status: 'already-complete' });
    expect(fixture.writes).toHaveLength(writesAfterSuccess);
  });

  it('leaves the roster recoverable when a committed write fails', async () => {
    const fixture = legacyFixture();
    fixture.failNextUpdateFor = 'relay_privileged_state';

    await expect(migration(fixture).run()).rejects.toThrow('Injected');
    expect(fixture.hasCollection('relay_operators')).toBe(true);

    await expect(migration(fixture).run()).resolves.toMatchObject({ status: 'migrated' });
    expect(fixture.hasCollection('relay_operators')).toBe(false);
  });

  it('seeds pending Ryan Owner and Charles Administrator accounts on a fresh server', async () => {
    const fixture = new MigrationFixture({
      relay_privileged_accounts: [],
      relay_privileged_state: [],
      relay_privileged_devices: [],
    });

    await expect(migration(fixture).run()).resolves.toEqual({
      status: 'migrated',
      ownerAccountId: 'account-ryan',
      administratorAccountIds: ['account-ryan', 'account-charles'],
    });
    expect(fixture.record('relay_privileged_accounts', 'account-ryan')).toMatchObject({
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      active: false,
      mustChangePassword: true,
    });
    expect(fixture.record('relay_privileged_accounts', 'account-charles')).toMatchObject({
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      active: false,
      mustChangePassword: true,
    });
    expect(fixture.record('relay_privileged_state', 'privileged-state')).not.toHaveProperty(
      'updatedAt',
    );
  });

  it('defers a corrupt partial fresh-install account before creating anything', async () => {
    const fixture = new MigrationFixture({
      relay_privileged_accounts: [
        {
          id: 'account-ryan',
          username: 'ryan',
          displayName: 'Not Ryan',
          storedRole: 'publisher',
          active: false,
          mustChangePassword: true,
        },
      ],
      relay_privileged_state: [],
    });

    await expect(migration(fixture).run()).resolves.toMatchObject({
      status: 'deferred',
      reason: expect.stringContaining('incomplete'),
    });
    expect(fixture.writes).toEqual([]);
  });
});
