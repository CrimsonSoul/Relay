/* eslint-disable sonarjs/publicly-writable-directories */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDummyDataAsync } from './dummyDataGenerator';
import fsPromises from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  },
}));

vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      debug: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000001'),
}));

describe('dummyDataGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true on successful data generation', async () => {
    const result = await generateDummyDataAsync('/tmp/test-data');
    expect(result).toBe(true);
  });

  it('creates the target directory', async () => {
    await generateDummyDataAsync('/tmp/test-data');
    expect(fsPromises.mkdir).toHaveBeenCalledWith('/tmp/test-data', { recursive: true });
  });

  it('writes contacts.json', async () => {
    await generateDummyDataAsync('/tmp/test-data');
    const calls = vi.mocked(fsPromises.writeFile).mock.calls;
    const contactsCall = calls.find(([path]) => String(path).endsWith('contacts.json'));
    expect(contactsCall).toBeDefined();
    const parsed = JSON.parse(contactsCall![1] as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(20);
    expect(parsed[0]).toMatchObject({
      name: 'Alice Johnson',
      email: 'alice@example.com',
      phone: '555-0100',
      title: 'Senior Engineer',
    });
  });

  it('writes bridgeGroups.json with expected groups', async () => {
    await generateDummyDataAsync('/tmp/test-data');
    const calls = vi.mocked(fsPromises.writeFile).mock.calls;
    const groupsCall = calls.find(([path]) => String(path).endsWith('bridgeGroups.json'));
    expect(groupsCall).toBeDefined();
    const parsed = JSON.parse(groupsCall![1] as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(5);
    expect(parsed[0].name).toBe('Core Engineering');
  });

  it('writes servers.json with expected servers', async () => {
    await generateDummyDataAsync('/tmp/test-data');
    const calls = vi.mocked(fsPromises.writeFile).mock.calls;
    const serversCall = calls.find(([path]) => String(path).endsWith('servers.json'));
    expect(serversCall).toBeDefined();
    const parsed = JSON.parse(serversCall![1] as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(10);
    expect(parsed[0].name).toBe('web-prod-01');
  });

  it('writes oncall.json with expected teams', async () => {
    await generateDummyDataAsync('/tmp/test-data');
    const calls = vi.mocked(fsPromises.writeFile).mock.calls;
    const oncallCall = calls.find(([path]) => String(path).endsWith('oncall.json'));
    expect(oncallCall).toBeDefined();
    const parsed = JSON.parse(oncallCall![1] as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(8);
    expect(parsed[0].team).toBe('SRE');
  });

  it('returns false when mkdir throws', async () => {
    vi.mocked(fsPromises.mkdir).mockRejectedValueOnce(new Error('permission denied'));
    const result = await generateDummyDataAsync('/tmp/test-data');
    expect(result).toBe(false);
  });

  it('returns false when writeFile throws', async () => {
    vi.mocked(fsPromises.writeFile).mockRejectedValueOnce(new Error('disk full'));
    const result = await generateDummyDataAsync('/tmp/test-data');
    expect(result).toBe(false);
  });

  it('includes id, createdAt, updatedAt in all records', async () => {
    await generateDummyDataAsync('/tmp/test-data');
    const calls = vi.mocked(fsPromises.writeFile).mock.calls;

    for (const call of calls) {
      const path = String(call[0]);
      if (path.endsWith('.json')) {
        const parsed = JSON.parse(call[1] as string) as Array<Record<string, unknown>>;
        for (const record of parsed) {
          expect(record).toHaveProperty('id');
          expect(record).toHaveProperty('createdAt');
          expect(record).toHaveProperty('updatedAt');
        }
      }
    }
  });
});
