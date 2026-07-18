import { describe, expect, it, vi } from 'vitest';
import { registerProductionAdministrationCommands } from '../privilegedRuntime';

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
});
