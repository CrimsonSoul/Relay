import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheClose: vi.fn(),
  createPending: vi.fn(),
}));

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn() } }));
vi.mock('../cache/OfflineCache', () => ({
  OfflineCache: class {
    close = mocks.cacheClose;
    checkpoint = () => true;
  },
}));
vi.mock('../cache/PendingChanges', () => ({
  PendingChanges: class {
    constructor(path: string) {
      mocks.createPending(path);
    }
  },
}));

import { checkpointClientDatabase } from './productionManualUpdateCheckpoint';

describe('checkpointClientDatabase', () => {
  it('closes the offline cache when the pending-changes store cannot open', () => {
    mocks.createPending.mockImplementation(() => {
      throw new Error('database locked');
    });

    expect(() => checkpointClientDatabase('relay.db')).toThrow('database locked');
    expect(mocks.cacheClose).toHaveBeenCalledOnce();
  });
});
