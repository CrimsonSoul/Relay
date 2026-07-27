import { describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
} from '@shared/privilegedAccess';
import type { PrivilegedCommandHandlerContext } from '../PrivilegedCommandProcessor';
import { registerProductionAdministrationCommands } from '../privilegedRuntime';

const NOW = '2026-07-18T01:30:00.000Z';

const ownerAccount = {
  id: 'account-owner',
  username: 'ryan',
  displayName: 'Ryan Bledsoe',
  storedRole: 'administrator' as const,
  active: true,
  mustChangePassword: false,
  credentialVersion: 2,
  revision: 4,
  created: NOW,
  updated: NOW,
};

const pairedDevice = {
  id: 'device-record',
  accountId: ownerAccount.id,
  deviceId: 'device-1',
  hostnameSnapshot: 'NOC-LT-01',
  label: 'Owner laptop',
  publicKey: '{"kty":"EC"}',
  fingerprint: `${'a'.repeat(56)}1a2b3c4d`,
  state: 'active' as const,
  pairedAt: '2026-07-18T01:00:00.000Z',
  lastUsedAt: '2026-07-18T01:20:00.000Z',
  revokedAt: null,
  revokedByAccountId: null,
  revision: 3,
  created: NOW,
  updated: NOW,
};

describe('production administration command wiring', () => {
  it('constructs and registers a real RoleAccountManager', () => {
    const registered = new Map<string, (context: unknown, payload: unknown) => Promise<unknown>>();
    const registrar = {
      registerCommand: vi.fn((command: string, _capability: string, handler: never) => {
        registered.set(command, handler);
      }),
    };
    const pb = { collection: vi.fn() };
    const onAuthorityChanged = vi.fn();

    const services = registerProductionAdministrationCommands({
      pb: pb as never,
      registrar: registrar as never,
      consumeReauthenticationProof: vi.fn(async () => true),
      onAuthorityChanged,
    });

    expect(services.roleAccountManager.constructor.name).toBe('RoleAccountManager');
    expect(services.coordinator.constructor.name).toBe('AuthorityMutationCoordinator');
    expect((services.roleAccountManager as unknown as { coordinator: unknown }).coordinator).toBe(
      services.coordinator,
    );
    expect((services.publisherManager as unknown as { coordinator: unknown }).coordinator).toBe(
      services.coordinator,
    );
    expect(
      (services.roleAccountManager as unknown as { onAuthorityChanged: unknown })
        .onAuthorityChanged,
    ).toBe(onAuthorityChanged);
    expect(
      (services.publisherManager as unknown as { onAssignmentChanged: unknown })
        .onAssignmentChanged,
    ).toBe(onAuthorityChanged);
    expect(registered.has('account.admin.create')).toBe(true);
    expect(registered.has('account.publisher.create')).toBe(true);
  });

  it('invokes the real production device manager for Owner rename and revoke', async () => {
    const registered = new Map<
      string,
      (context: PrivilegedCommandHandlerContext, payload: never) => Promise<unknown>
    >();
    const update = vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
      ...pairedDevice,
      ...patch,
    }));
    const deviceCollection = {
      getFirstListItem: vi.fn(async () => pairedDevice),
      update,
    };
    const accountCollection = { getOne: vi.fn(async () => ownerAccount) };
    const pb = {
      collection: vi.fn((name: string) => {
        if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
        if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
        throw new Error(`Unexpected collection ${name}`);
      }),
    };
    registerProductionAdministrationCommands({
      pb: pb as never,
      registrar: {
        registerCommand: vi.fn((command: string, _capability: string, handler: never) => {
          registered.set(command, handler);
        }),
      } as never,
      consumeReauthenticationProof: vi.fn(async () => true),
    });
    const context = {
      account: ownerAccount,
      device: null,
      role: 'owner',
      requestId: 'request-owner',
    } as unknown as PrivilegedCommandHandlerContext;

    await expect(
      registered.get('privileged.device.rename')!(context, {
        deviceId: pairedDevice.deviceId,
        label: 'Primary owner laptop',
        expectedRevision: 3,
      } as never),
    ).resolves.toMatchObject({
      accountId: ownerAccount.id,
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      label: 'Primary owner laptop',
    });
    await expect(
      registered.get('privileged.device.revoke')!(context, {
        deviceId: pairedDevice.deviceId,
        expectedRevision: 3,
        reauthRequestId: 'reauth-owner',
      } as never),
    ).resolves.toMatchObject({ state: 'revoked', accountId: ownerAccount.id });

    expect(update).toHaveBeenNthCalledWith(
      2,
      pairedDevice.id,
      expect.objectContaining({ revokedByAccountId: ownerAccount.id }),
      { requestKey: null },
    );
    expect(pb.collection).not.toHaveBeenCalledWith('relay_operators');
  });

  it('reports a production device revocation so the revoked session can be ended', async () => {
    const registered = new Map<
      string,
      (context: PrivilegedCommandHandlerContext, payload: never) => Promise<unknown>
    >();
    const deviceCollection = {
      getFirstListItem: vi.fn(async () => pairedDevice),
      update: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
        ...pairedDevice,
        ...patch,
      })),
    };
    const pb = {
      collection: vi.fn((name: string) => {
        if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
        if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
          return { getOne: async () => ownerAccount };
        throw new Error(`Unexpected collection ${name}`);
      }),
    };
    const onDeviceRevoked = vi.fn();
    registerProductionAdministrationCommands({
      pb: pb as never,
      registrar: {
        registerCommand: vi.fn((command: string, _capability: string, handler: never) => {
          registered.set(command, handler);
        }),
      } as never,
      consumeReauthenticationProof: vi.fn(async () => true),
      onDeviceRevoked,
    });

    await registered.get('privileged.device.revoke')!(
      {
        account: ownerAccount,
        device: null,
        role: 'owner',
        requestId: 'request-owner',
      } as unknown as PrivilegedCommandHandlerContext,
      {
        deviceId: pairedDevice.deviceId,
        expectedRevision: 3,
        reauthRequestId: 'reauth-owner',
      } as never,
    );

    expect(onDeviceRevoked).toHaveBeenCalledWith(ownerAccount.id, pairedDevice.deviceId);
  });

  it('does not mutate through the production handler when account projection cannot be proven', async () => {
    const registered = new Map<
      string,
      (context: PrivilegedCommandHandlerContext, payload: never) => Promise<unknown>
    >();
    const update = vi.fn();
    const pb = {
      collection: vi.fn((name: string) => {
        if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) {
          return { getFirstListItem: vi.fn(async () => pairedDevice), update };
        }
        if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) {
          return { getOne: vi.fn(async () => Promise.reject(new Error('account unavailable'))) };
        }
        throw new Error(`Unexpected collection ${name}`);
      }),
    };
    registerProductionAdministrationCommands({
      pb: pb as never,
      registrar: {
        registerCommand: vi.fn((command: string, _capability: string, handler: never) => {
          registered.set(command, handler);
        }),
      } as never,
      consumeReauthenticationProof: vi.fn(async () => true),
    });

    await expect(
      registered.get('privileged.device.rename')!(
        {
          account: ownerAccount,
          device: null,
          role: 'owner',
          requestId: 'request-owner',
        } as unknown as PrivilegedCommandHandlerContext,
        {
          deviceId: pairedDevice.deviceId,
          label: 'Must not persist',
          expectedRevision: 3,
        } as never,
      ),
    ).rejects.toThrow('account unavailable');
    expect(update).not.toHaveBeenCalled();
  });
});
