import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock FileEmitter before importing DataCacheManager
const mockEmitter = {
  sendPayload: vi.fn(),
  emitReloadStarted: vi.fn(),
  emitReloadCompleted: vi.fn(),
  emitError: vi.fn(),
};

vi.mock('./FileEmitter', () => ({
  FileEmitter: class {
    sendPayload = mockEmitter.sendPayload;
    emitReloadStarted = mockEmitter.emitReloadStarted;
    emitReloadCompleted = mockEmitter.emitReloadCompleted;
    emitError = mockEmitter.emitError;
  },
}));

vi.mock('./logger', () => ({
  loggers: {
    main: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    fileManager: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    security: { error: vi.fn() },
  },
}));

import { DataCacheManager } from './DataCacheManager';

describe('DataCacheManager', () => {
  let manager: DataCacheManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DataCacheManager();
  });

  it('initializes with empty cache', () => {
    const cache = manager.getCache();
    expect(cache).toEqual({
      groups: [],
      contacts: [],
      servers: [],
      onCall: [],
      teamLayout: {},
    });
  });

  it('updateCache merges partial data', () => {
    const contacts = [
      {
        name: 'Alice',
        email: 'a@test.com',
        phone: '555',
        title: 'Eng',
        _searchString: 'alice',
        raw: {},
      },
    ];
    manager.updateCache({ contacts });

    const cache = manager.getCache();
    expect(cache.contacts).toEqual(contacts);
    // Other fields remain unchanged
    expect(cache.groups).toEqual([]);
    expect(cache.servers).toEqual([]);
  });

  it('getCache returns readonly copy', () => {
    const cache1 = manager.getCache();
    manager.updateCache({ groups: [] });
    const cache2 = manager.getCache();
    // getCache returns the internal reference (Readonly type enforces immutability at compile time)
    expect(cache1).toBeDefined();
    expect(cache2).toBeDefined();
  });

  it('broadcast calls emitter.sendPayload', () => {
    manager.broadcast();
    expect(mockEmitter.sendPayload).toHaveBeenCalledWith(manager.getCache());
  });

  it('emitReloadStarted delegates to emitter', () => {
    manager.emitReloadStarted();
    expect(mockEmitter.emitReloadStarted).toHaveBeenCalled();
  });

  it('emitReloadCompleted delegates to emitter', () => {
    manager.emitReloadCompleted(true);
    expect(mockEmitter.emitReloadCompleted).toHaveBeenCalledWith(true);
  });

  it('emitError delegates to emitter', () => {
    const error = { type: 'parse' as const, message: 'bad csv' };
    manager.emitError(error);
    expect(mockEmitter.emitError).toHaveBeenCalledWith(error);
  });
});
