import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_OPERATOR_DISPLAY_NAME_LENGTH, type RelayOperatorRecord } from '@shared/operators';
import { RelayOperatorManager } from './RelayOperatorManager';

function operator(overrides: Partial<RelayOperatorRecord> = {}): RelayOperatorRecord {
  return {
    id: 'operator-1',
    displayName: 'Ryan Bell',
    active: true,
    created: '2026-07-13 08:00:00.000Z',
    updated: '2026-07-13 08:00:00.000Z',
    ...overrides,
  };
}

describe('RelayOperatorManager', () => {
  const collection = {
    getFullList: vi.fn(async () => [] as RelayOperatorRecord[]),
    getOne: vi.fn(async () => operator()),
    create: vi.fn(async (data: unknown) => operator(data as Partial<RelayOperatorRecord>)),
    update: vi.fn(async (id: string, data: unknown) =>
      operator({ id, ...(data as Partial<RelayOperatorRecord>) }),
    ),
  };
  const pb = {
    collection: vi.fn(() => collection),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    collection.getFullList.mockResolvedValue([]);
    collection.getOne.mockResolvedValue(operator());
  });

  it('creates an active operator with a normalized display name', async () => {
    const manager = new RelayOperatorManager(pb as never);

    await expect(manager.create({ displayName: '  Morgan   Lee  ' })).resolves.toMatchObject({
      displayName: 'Morgan Lee',
      active: true,
    });
    expect(collection.create).toHaveBeenCalledWith(
      { displayName: 'Morgan Lee', active: true },
      { requestKey: null },
    );
  });

  it('renames an existing operator after checking its current revision', async () => {
    const manager = new RelayOperatorManager(pb as never);

    await expect(
      manager.rename({
        id: 'operator-1',
        displayName: '  Ryan   Cooper ',
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      }),
    ).resolves.toMatchObject({ id: 'operator-1', displayName: 'Ryan Cooper' });
    expect(collection.getOne).toHaveBeenCalledWith('operator-1', { requestKey: null });
    expect(collection.update).toHaveBeenCalledWith(
      'operator-1',
      { displayName: 'Ryan Cooper' },
      { requestKey: null },
    );
  });

  it.each([
    ['deactivates', false],
    ['reactivates', true],
  ])('%s an existing operator after checking its current revision', async (_label, active) => {
    collection.getOne.mockResolvedValue(operator({ active: !active }));
    const manager = new RelayOperatorManager(pb as never);

    await expect(
      manager.setActive({
        id: 'operator-1',
        active,
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      }),
    ).resolves.toMatchObject({ id: 'operator-1', active });
    expect(collection.update).toHaveBeenCalledWith('operator-1', { active }, { requestKey: null });
  });

  it('rejects duplicate names case-insensitively across active and inactive operators', async () => {
    collection.getFullList.mockResolvedValue([
      operator({ id: 'operator-2', displayName: 'MORGAN LEE', active: false }),
    ]);
    const manager = new RelayOperatorManager(pb as never);

    await expect(manager.create({ displayName: 'morgan lee' })).rejects.toThrow(
      'An operator with this display name already exists.',
    );
    await expect(
      manager.rename({
        id: 'operator-1',
        displayName: 'Morgan Lee',
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      }),
    ).rejects.toThrow('An operator with this display name already exists.');
    expect(collection.create).not.toHaveBeenCalled();
    expect(collection.update).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'Enter an operator display name.'],
    [
      'x'.repeat(MAX_OPERATOR_DISPLAY_NAME_LENGTH + 1),
      `Operator display names can be up to ${MAX_OPERATOR_DISPLAY_NAME_LENGTH} characters.`,
    ],
  ])('rejects invalid display name %#', async (displayName, message) => {
    const manager = new RelayOperatorManager(pb as never);

    await expect(manager.create({ displayName })).rejects.toThrow(message);
    await expect(
      manager.rename({
        id: 'operator-1',
        displayName,
        expectedUpdated: '2026-07-13 08:00:00.000Z',
      }),
    ).rejects.toThrow(message);
    expect(collection.create).not.toHaveBeenCalled();
    expect(collection.update).not.toHaveBeenCalled();
  });

  it.each(['rename', 'setActive'] as const)('reports missing records during %s', async (method) => {
    collection.getOne.mockRejectedValue({ status: 404 });
    const manager = new RelayOperatorManager(pb as never);
    const input = {
      id: 'missing-operator',
      displayName: 'Morgan Lee',
      active: false,
      expectedUpdated: '2026-07-13 08:00:00.000Z',
    };

    await expect(manager[method](input)).rejects.toThrow('Operator not found.');
    expect(collection.update).not.toHaveBeenCalled();
  });

  it.each(['rename', 'setActive'] as const)('rejects stale %s writes', async (method) => {
    collection.getOne.mockResolvedValue(operator({ updated: '2026-07-13 09:00:00.000Z' }));
    const manager = new RelayOperatorManager(pb as never);
    const input = {
      id: 'operator-1',
      displayName: 'Morgan Lee',
      active: false,
      expectedUpdated: '2026-07-13 08:00:00.000Z',
    };

    await expect(manager[method](input)).rejects.toThrow(
      'This operator changed since it was loaded. Refresh and try again.',
    );
    expect(collection.update).not.toHaveBeenCalled();
  });
});
