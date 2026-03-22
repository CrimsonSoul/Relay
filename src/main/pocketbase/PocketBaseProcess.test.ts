import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PocketBaseProcess } from './PocketBaseProcess';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../logger', () => ({
  loggers: {
    pocketbase: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('PocketBaseProcess', () => {
  let pbProcess: PocketBaseProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      migrationsDir: '/fake/data/pb_migrations',
      host: '127.0.0.1',
      port: 8090,
    });
  });

  it('constructs with correct config', () => {
    expect(pbProcess.getUrl()).toBe('http://127.0.0.1:8090');
  });

  it('isRunning returns false before start', () => {
    expect(pbProcess.isRunning()).toBe(false);
  });

  it('getUrl returns the correct URL', () => {
    const pb = new PocketBaseProcess({
      binaryPath: '/fake/pb',
      dataDir: '/fake/data',
      migrationsDir: '/fake/migrations',
      host: '0.0.0.0',
      port: 9090,
    });
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(pb.getUrl()).toBe('http://0.0.0.0:9090');
  });

  it('builds correct spawn args', () => {
    expect(pbProcess.getSpawnArgs()).toEqual([
      'serve',
      '--http=127.0.0.1:8090',
      '--dir=/fake/data/pb_data',
      '--migrationsDir=/fake/data/pb_migrations',
    ]);
  });
});
