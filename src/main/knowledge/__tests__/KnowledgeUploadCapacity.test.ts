import { describe, expect, it, vi } from 'vitest';
import {
  KnowledgeUploadCapacity,
  type KnowledgeUploadCapacityProbe,
} from '../KnowledgeUploadCapacity';

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

function createCapacity(
  options: {
    availableBytes?: number;
    active?: boolean;
    error?: Error;
  } = {},
) {
  const probe: KnowledgeUploadCapacityProbe = {
    availableBytes: options.error
      ? vi.fn(async () => Promise.reject(options.error))
      : vi.fn(async () => options.availableBytes ?? 10 * GiB),
  };
  const hasActiveBatch = vi.fn(async () => options.active ?? false);
  return {
    capacity: new KnowledgeUploadCapacity({
      storagePath: '/private/pb_data/storage',
      probe,
      hasActiveBatch,
    }),
    hasActiveBatch,
    probe,
  };
}

describe('KnowledgeUploadCapacity', () => {
  it('accepts a bounded batch while preserving the two GiB floor and assembly allowance', async () => {
    const { capacity, probe, hasActiveBatch } = createCapacity({
      availableBytes: 2 * GiB + 50 * MiB + 4 * MiB,
    });

    await expect(
      capacity.assertBatch({ accountId: 'account-1', fileCount: 1, totalBytes: 4 * MiB }),
    ).resolves.toBeUndefined();
    expect(probe.availableBytes).toHaveBeenCalledWith('/private/pb_data/storage');
    expect(hasActiveBatch).toHaveBeenCalledWith('account-1');
  });

  it('rejects a reservation that would consume the free-space floor', async () => {
    const { capacity } = createCapacity({ availableBytes: 6 * GiB });

    await expect(
      capacity.assertBatch({ accountId: 'account-1', fileCount: 100, totalBytes: 5_000 * MiB }),
    ).rejects.toMatchObject({ code: 'insufficient-storage' });
  });

  it.each([
    { accountId: 'account-1', fileCount: 0, totalBytes: 1 },
    { accountId: 'account-1', fileCount: 101, totalBytes: 1 },
    { accountId: 'account-1', fileCount: 1, totalBytes: 0 },
    { accountId: 'account-1', fileCount: 100, totalBytes: 5_000 * MiB + 1 },
  ])('rejects invalid declared limits without probing disk: %o', async (input) => {
    const { capacity, probe } = createCapacity();

    await expect(capacity.assertBatch(input)).rejects.toMatchObject({ code: 'invalid-request' });
    expect(probe.availableBytes).not.toHaveBeenCalled();
  });

  it('rejects a second active batch for the same privileged account', async () => {
    const { capacity, probe } = createCapacity({ active: true });

    await expect(
      capacity.assertBatch({ accountId: 'account-1', fileCount: 1, totalBytes: 10 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(probe.availableBytes).not.toHaveBeenCalled();
  });

  it('maps filesystem failures to a bounded storage error', async () => {
    const { capacity } = createCapacity({ error: new Error('/private/pb_data/storage denied') });

    await expect(
      capacity.assertBatch({ accountId: 'account-1', fileCount: 1, totalBytes: 10 }),
    ).rejects.toMatchObject({
      code: 'insufficient-storage',
      message: 'The Relay server does not have enough verified storage for this upload batch.',
    });
  });
});
