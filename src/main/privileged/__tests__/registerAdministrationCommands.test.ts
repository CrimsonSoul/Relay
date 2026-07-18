import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivilegedCommandHandlerContext } from '../PrivilegedCommandProcessor';
import { registerAdministrationCommands } from '../registerAdministrationCommands';
import { RoleAccountConflictError } from '../RoleAccountManager';

const context = {
  account: { id: 'account-charles' },
  device: null,
  role: 'admin',
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
  const roleAccountManager = {
    createAdministrator: vi.fn(async (input) => input),
    createPublisher: vi.fn(async (input) => input),
    updateDisplayName: vi.fn(async (input) => input),
    setActive: vi.fn(async (input) => input),
    transferOwnership: vi.fn(async (input) => input),
  };
  const publisherManager = { assign: vi.fn(async (input) => input) };
  const consumeReauthenticationProof = vi.fn(async () => true);
  const deviceManager = {
    rename: vi.fn(async (input) => input),
    revoke: vi.fn(async (input) => input),
  };
  const administrationService = { replace: vi.fn(async (payload) => payload) };
  const snapshotReader = { read: vi.fn(async () => ({ generatedAt: '2026-07-17T15:00:00.000Z' })) };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    consumeReauthenticationProof.mockResolvedValue(true);
    registerAdministrationCommands({
      registrar: registrar as never,
      roleAccountManager: roleAccountManager as never,
      publisherManager: publisherManager as never,
      consumeReauthenticationProof,
      deviceManager: deviceManager as never,
      administrationService: administrationService as never,
      snapshotReader: snapshotReader as never,
    });
  });

  it('removes operator commands and registers the account allowlist under narrow capabilities', () => {
    expect(
      registrar.registerCommand.mock.calls.map(([command, capability]) => [command, capability]),
    ).toEqual([
      ['account.admin.create', 'accounts.manage'],
      ['account.publisher.create', 'publisher.assign'],
      ['account.display-name.update', 'publisher.assign'],
      ['account.active.set', 'publisher.assign'],
      ['ownership.transfer', 'ownership.transfer'],
      ['publisher.assign', 'publisher.assign'],
      ['privileged.device.rename', 'devices.manage'],
      ['privileged.device.revoke', 'devices.manage'],
      ['administration.snapshot.read', 'settings.manage'],
      ['administration.setting.replace', 'settings.manage'],
    ]);
    expect(handlers.has('operator.create')).toBe(false);
  });

  it('passes authenticated actor account IDs to account lifecycle commands', async () => {
    await handlers.get('account.admin.create')!(context, {
      username: 'morgan',
      displayName: 'Morgan Lee',
      expectedStateRevision: 4,
    } as never);
    await handlers.get('account.display-name.update')!(context, {
      accountId: 'account-publisher',
      displayName: 'Publisher Two',
      expectedRevision: 2,
    } as never);
    expect(roleAccountManager.createAdministrator).toHaveBeenCalledWith({
      actorAccountId: 'account-charles',
      username: 'morgan',
      displayName: 'Morgan Lee',
      expectedStateRevision: 4,
    });
    expect(roleAccountManager.updateDisplayName).toHaveBeenCalledWith({
      actorAccountId: 'account-charles',
      accountId: 'account-publisher',
      displayName: 'Publisher Two',
      expectedRevision: 2,
    });
  });

  it('requires and consumes fresh reauthentication before ownership transfer and Publisher replacement', async () => {
    await handlers.get('ownership.transfer')!(context, {
      accountId: 'account-charles',
      expectedStateRevision: 4,
      reauthRequestId: 'reauth-owner',
    } as never);
    await handlers.get('publisher.assign')!(context, {
      accountId: 'account-publisher',
      expectedStateRevision: 5,
      reauthRequestId: 'reauth-publisher',
    } as never);
    expect(consumeReauthenticationProof).toHaveBeenNthCalledWith(1, 'reauth-owner', {
      accountId: 'account-charles',
      deviceId: null,
    });
    expect(consumeReauthenticationProof).toHaveBeenNthCalledWith(2, 'reauth-publisher', {
      accountId: 'account-charles',
      deviceId: null,
    });
    expect(publisherManager.assign).toHaveBeenCalledWith({
      actorAccountId: 'account-charles',
      accountId: 'account-publisher',
      expectedStateRevision: 5,
    });

    consumeReauthenticationProof.mockResolvedValueOnce(false);
    await expect(
      handlers.get('publisher.assign')!(context, {
        accountId: null,
        expectedStateRevision: 6,
        reauthRequestId: 'used',
      } as never),
    ).rejects.toMatchObject({ name: 'PrivilegedCommandAuthorizationError' });
  });

  it('returns only manager snapshots and reads administration by active account', async () => {
    await handlers.get('administration.snapshot.read')!(context, {} as never);
    expect(snapshotReader.read).toHaveBeenCalledWith({ accountId: 'account-charles' });
  });

  it('translates stale account writes to the existing command conflict shape', async () => {
    roleAccountManager.setActive.mockRejectedValueOnce(new RoleAccountConflictError(8));
    await expect(
      handlers.get('account.active.set')!(context, {
        accountId: 'account-publisher',
        active: false,
        expectedRevision: 7,
      } as never),
    ).rejects.toMatchObject({ name: 'PrivilegedCommandConflictError', currentRevision: 8 });
  });
});
