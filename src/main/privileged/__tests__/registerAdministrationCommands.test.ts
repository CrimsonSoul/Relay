import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivilegedCommandHandlerContext } from '../PrivilegedCommandProcessor';
import { registerAdministrationCommands } from '../registerAdministrationCommands';

const context = {
  account: { id: 'account-1' },
  operator: { id: 'admin-1' },
  state: {
    adminOperatorId: 'admin-1',
    publisherOperatorId: 'publisher-1',
  },
  device: null,
  role: 'admin',
  capabilities: ['operators.manage'],
} as unknown as PrivilegedCommandHandlerContext;

describe('registerAdministrationCommands', () => {
  const handlers = new Map<
    string,
    (context: PrivilegedCommandHandlerContext, payload: never) => Promise<unknown>
  >();
  const registrar = {
    registerCommand: vi.fn((command: string, capability: string, handler: never) => {
      handlers.set(command, handler);
      return capability;
    }),
  };
  const operatorManager = {
    create: vi.fn(async (input) => ({ id: 'operator-2', ...input, active: true, revision: 0 })),
    renameByRevision: vi.fn(async (input) => ({ id: input.operatorId, ...input })),
    setActiveByRevision: vi.fn(async (input) => ({ id: input.operatorId, ...input })),
    getRoleProtectionState: vi.fn(async () => ({
      adminOperatorId: 'admin-1',
      publisherOperatorId: 'publisher-1',
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    registerAdministrationCommands({
      registrar: registrar as never,
      operatorManager: operatorManager as never,
    });
  });

  it('registers only operator mutations under the operators.manage capability', () => {
    expect(
      registrar.registerCommand.mock.calls.map(([command, capability]) => [command, capability]),
    ).toEqual([
      ['operator.create', 'operators.manage'],
      ['operator.rename', 'operators.manage'],
      ['operator.active.set', 'operators.manage'],
    ]);
  });

  it('uses the shared operator manager for create and revision-safe rename', async () => {
    await handlers.get('operator.create')!(context, { displayName: 'Morgan Lee' } as never);
    await handlers.get('operator.rename')!(context, {
      operatorId: 'operator-2',
      displayName: 'Morgan Cooper',
      expectedRevision: 3,
    } as never);

    expect(operatorManager.create).toHaveBeenCalledWith({ displayName: 'Morgan Lee' });
    expect(operatorManager.renameByRevision).toHaveBeenCalledWith({
      operatorId: 'operator-2',
      displayName: 'Morgan Cooper',
      expectedRevision: 3,
    });
  });

  it('rechecks current administrator and publisher protection immediately before active changes', async () => {
    await handlers.get('operator.active.set')!(context, {
      operatorId: 'operator-2',
      active: false,
      expectedRevision: 3,
    } as never);

    expect(operatorManager.setActiveByRevision).toHaveBeenCalledWith(
      { operatorId: 'operator-2', active: false, expectedRevision: 3 },
      { adminOperatorId: 'admin-1', publisherOperatorId: 'publisher-1' },
    );
  });
});
