import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_COMMANDS_COLLECTION,
  RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION,
} from '@shared/privilegedAccess';
import type { SignedPrivilegedCommandEnvelope } from '@shared/privilegedCommands';
import {
  PocketBasePrivilegedRepository,
  PrivilegedPocketBaseClientTransport,
  PrivilegedServerQueue,
} from '../PrivilegedPocketBaseTransport';

const envelope: SignedPrivilegedCommandEnvelope = {
  version: 1,
  requestId: 'request-1',
  accountId: 'account-admin',
  deviceId: 'device-1',
  roleClaim: 'admin',
  displayNameSnapshot: 'Ryan Bledsoe',
  command: 'privileged.status.read',
  payload: { clientVersion: '1' },
  payloadHash: 'a'.repeat(64),
  expectedRevision: null,
  issuedAt: '2026-07-15T12:00:00.000Z',
  expiresAt: '2026-07-15T12:01:00.000Z',
  signature: 's'.repeat(86),
};

describe('PrivilegedPocketBaseClientTransport', () => {
  let createRecord: ReturnType<typeof vi.fn>;
  let getRecord: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createRecord = vi.fn(async (_collection, data) => ({ id: 'record-1', ...data }));
    getRecord = vi
      .fn()
      .mockResolvedValueOnce({ id: 'record-1', state: 'pending' })
      .mockResolvedValueOnce({
        id: 'record-1',
        requestId: 'request-1',
        state: 'succeeded',
        result: { status: 'ready' },
      });
  });

  it('submits a signed command and returns only its safe completed result', async () => {
    const transport = new PrivilegedPocketBaseClientTransport({
      client: { createRecord, getRecord },
      wait: vi.fn(async () => undefined),
    });

    await expect(transport.submitCommand(envelope, 'b'.repeat(64))).resolves.toEqual({
      ok: true,
      requestId: 'request-1',
      value: { status: 'ready' },
    });
    expect(createRecord).toHaveBeenCalledWith(
      RELAY_PRIVILEGED_COMMANDS_COLLECTION,
      expect.objectContaining({
        requestId: 'request-1',
        displayNameSnapshot: 'Ryan Bledsoe',
        state: 'pending',
        hasExpectedRevision: false,
      }),
    );
    expect(JSON.stringify(createRecord.mock.calls)).not.toContain('token');
  });

  it('preserves a bounded authorization failure when stale account authority rejects submission', async () => {
    createRecord.mockRejectedValueOnce({ code: 'invalid-credentials' });
    const transport = new PrivilegedPocketBaseClientTransport({
      client: { createRecord, getRecord },
      wait: vi.fn(async () => undefined),
    });

    await expect(transport.submitCommand(envelope, 'b'.repeat(64))).resolves.toEqual({
      ok: false,
      requestId: 'request-1',
      error: 'unauthorized',
    });
  });

  it('submits and normalizes a one-time pairing request', async () => {
    getRecord.mockReset();
    getRecord.mockResolvedValueOnce({
      id: 'pairing-record',
      state: 'completed',
      result: {
        deviceId: 'device-1',
        fingerprint: 'f'.repeat(64),
        pairedAt: '2026-07-15T12:00:00.000Z',
      },
    });
    const transport = new PrivilegedPocketBaseClientTransport({
      client: { createRecord, getRecord },
      createId: () => 'pairing-request-1',
      wait: vi.fn(async () => undefined),
    });

    const result = await transport.completePairing({
      challengeId: 'challenge-1',
      accountId: 'account-admin',
      authenticatedAccountId: 'account-admin',
      displayNameSnapshot: 'Ryan Bledsoe',
      code: 'ABCD2345',
      publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'f'.repeat(64),
      hostname: 'RYAN-LAPTOP',
      deviceLabel: 'Ryan work laptop',
    });

    expect(createRecord).toHaveBeenCalledWith(
      RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION,
      expect.objectContaining({
        requestId: 'pairing-request-1',
        code: 'ABCD2345',
        state: 'pending',
      }),
    );
    expect(result).toMatchObject({ deviceId: 'device-1' });
  });
});

describe('PocketBasePrivilegedRepository', () => {
  it('normalizes account-based owner and Publisher assignments', async () => {
    const getFirstListItem = vi.fn(async () => ({
      id: 'state-1',
      key: 'primary',
      ownerAccountId: 'account-ryan',
      publisherAccountId: 'account-publisher',
      assignmentVersion: 2,
      identityMigrationVersion: 2,
      updatedByAccountId: 'account-ryan',
      created: '2026-07-16T12:00:00.000Z',
      updated: '2026-07-16T12:00:00.000Z',
    }));
    const repository = new PocketBasePrivilegedRepository({
      collection: vi.fn(() => ({ getFirstListItem })),
    } as never);

    await expect(repository.getState()).resolves.toMatchObject({
      ownerAccountId: 'account-ryan',
      publisherAccountId: 'account-publisher',
    });
  });

  it('recognizes stored administration commands instead of recreating their request IDs', async () => {
    const getFirstListItem = vi.fn(async () => ({
      id: 'command-record',
      requestId: 'request-admin',
      accountId: 'account-admin',
      deviceId: 'device-1',
      displayNameSnapshot: 'Ryan Bledsoe',
      roleClaim: 'admin',
      command: 'administration.snapshot.read',
      payload: {},
      bodyHash: 'b'.repeat(64),
      issuedAt: '2026-07-15T12:00:00.000Z',
      expiresAt: '2026-07-15T12:01:00.000Z',
      hasExpectedRevision: false,
      expectedRevision: 0,
      signature: 's'.repeat(86),
      state: 'pending',
      result: null,
      safeError: '',
      completedAt: '',
      updated: '2026-07-15T12:00:00.000Z',
    }));
    const create = vi.fn();
    const update = vi.fn(async () => ({}));
    const repository = new PocketBasePrivilegedRepository({
      collection: vi.fn(() => ({ getFirstListItem, create, update })),
    } as never);

    await expect(
      repository.claimCommand({
        requestId: 'request-admin',
        accountId: 'account-admin',
        deviceId: 'device-1',
        operatorId: null,
        displayNameSnapshot: 'Ryan Bledsoe',
        roleClaim: 'admin',
        command: 'administration.snapshot.read',
        payload: {},
        bodyHash: 'b'.repeat(64),
        issuedAt: '2026-07-15T12:00:00.000Z',
        expiresAt: '2026-07-15T12:01:00.000Z',
        expectedRevision: null,
        signature: 's'.repeat(86),
        state: 'processing',
      }),
    ).resolves.toMatchObject({
      kind: 'existing',
      command: { command: 'administration.snapshot.read' },
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      'command-record',
      { displayNameSnapshot: 'Ryan Bledsoe', operatorId: '' },
      { requestKey: null },
    );
  });

  it('accepts PocketBase auth records that omit non-authorizing timestamps', async () => {
    const getOne = vi.fn(async () => ({
      id: 'account-admin',
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      active: true,
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 3,
    }));
    const repository = new PocketBasePrivilegedRepository({
      collection: vi.fn(() => ({ getOne })),
    } as never);

    await expect(repository.getAccount('account-admin')).resolves.toMatchObject({
      id: 'account-admin',
      created: '',
      updated: '',
    });
  });

  it('activates paired devices with the validated label and completes the challenge', async () => {
    const create = vi.fn(async (data) => ({ id: 'record-device', ...data }));
    const update = vi.fn(async () => ({}));
    const pb = {
      collection: vi.fn((name: string) => ({
        create: name === 'relay_privileged_devices' ? create : vi.fn(),
        update,
      })),
    };
    const repository = new PocketBasePrivilegedRepository(pb as never);

    const result = await repository.activateDevice({
      challengeId: 'challenge-1',
      secretHash: 's'.repeat(64),
      accountId: 'account-admin',
      deviceId: 'device-1',
      hostnameSnapshot: 'RYAN-LAPTOP',
      label: 'Ryan work laptop',
      publicKey: '{"kty":"EC"}',
      fingerprint: 'f'.repeat(64),
      state: 'active',
      pairedAt: '2026-07-15T12:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      revokedByAccountId: null,
      revision: 1,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ label: 'Ryan work laptop' }), {
      requestKey: null,
    });
    expect(result).toMatchObject({ deviceId: 'device-1', fingerprint: 'f'.repeat(64) });
  });

  it('consumes one reauthentication proof atomically within the server process', async () => {
    let proofConsumedAt = '';
    const collection = {
      getFirstListItem: vi.fn(async () => ({
        id: 'proof-record',
        proofConsumedAt,
      })),
      update: vi.fn(async (_id, patch: { proofConsumedAt: string }) => {
        await Promise.resolve();
        proofConsumedAt = patch.proofConsumedAt;
        return {};
      }),
    };
    const repository = new PocketBasePrivilegedRepository({
      collection: vi.fn(() => collection),
    } as never);

    const results = await Promise.all([
      repository.consumeReauthenticationProof('proof-1', '2026-07-15T12:00:00.000Z'),
      repository.consumeReauthenticationProof('proof-1', '2026-07-15T12:00:00.001Z'),
    ]);

    expect(results).toEqual([true, false]);
    expect(collection.update).toHaveBeenCalledOnce();
  });
});

describe('PrivilegedServerQueue', () => {
  it('processes pending signed commands and pairing requests, then redacts the human code', async () => {
    const commandRecord = {
      id: 'command-record',
      ...envelope,
      bodyHash: 'b'.repeat(64),
      hasExpectedRevision: false,
      state: 'pending',
    };
    const pairingRecord = {
      id: 'pairing-record',
      requestId: 'pairing-request-1',
      accountId: 'account-admin',
      displayNameSnapshot: 'Forged Name',
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'f'.repeat(64),
      hostname: 'RYAN-LAPTOP',
      deviceLabel: 'Ryan work laptop',
      state: 'pending',
    };
    const updateCommand = vi.fn(async () => ({}));
    const updatePairing = vi.fn(async () => ({}));
    const pb = {
      collection: vi.fn((name: string) => ({
        getFullList: vi.fn(async () =>
          name === RELAY_PRIVILEGED_COMMANDS_COLLECTION ? [commandRecord] : [pairingRecord],
        ),
        getOne: vi.fn(async () => ({
          id: 'account-admin',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          storedRole: 'administrator',
          active: true,
          mustChangePassword: false,
          credentialVersion: 1,
          revision: 3,
        })),
        update: name === RELAY_PRIVILEGED_COMMANDS_COLLECTION ? updateCommand : updatePairing,
      })),
    };
    const processor = {
      process: vi.fn(async () => ({ ok: true, requestId: 'request-1', value: {} })),
    };
    const pairingService = {
      completePairing: vi.fn(async () => ({
        deviceId: 'device-1',
        fingerprint: 'f'.repeat(64),
        pairedAt: '2026-07-15T12:00:00.000Z',
      })),
    };
    const queue = new PrivilegedServerQueue({
      commandProcessor: processor as never,
      pairingService: pairingService as never,
      pb: pb as never,
    });

    await queue.drain();

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(pairingService.completePairing).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ABCD2345', authenticatedAccountId: 'account-admin' }),
    );
    expect(updatePairing).toHaveBeenCalledWith(
      'pairing-record',
      expect.objectContaining({
        code: 'REDACTED',
        displayNameSnapshot: 'Ryan Bledsoe',
        state: 'completed',
      }),
      { requestKey: null },
    );
  });

  it.each([
    ['accountId', ['account-admin']],
    ['challengeId', ['challenge-1']],
    ['code', ['ABCD2345']],
    ['fingerprint', ['f'.repeat(64)]],
    ['hostname', ['RYAN-LAPTOP']],
    ['deviceLabel', ['Ryan work laptop']],
  ])('rejects a pairing record with a string-coercible %s array', async (field, malformedValue) => {
    const pairingRecord: Record<string, unknown> = {
      id: 'pairing-record',
      requestId: 'pairing-request-1',
      accountId: 'account-admin',
      displayNameSnapshot: 'Forged Name',
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'f'.repeat(64),
      hostname: 'RYAN-LAPTOP',
      deviceLabel: 'Ryan work laptop',
      state: 'pending',
      [field]: malformedValue,
    };
    const updatePairing = vi.fn(async () => ({}));
    const pb = {
      collection: vi.fn((name: string) => ({
        getFullList: vi.fn(async () =>
          name === RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION ? [pairingRecord] : [],
        ),
        getOne: vi.fn(async () => ({
          id: 'account-admin',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          storedRole: 'administrator',
          active: true,
          mustChangePassword: false,
          credentialVersion: 1,
          revision: 3,
        })),
        update: updatePairing,
      })),
    };
    const pairingService = {
      completePairing: vi.fn(async () => ({
        deviceId: 'device-1',
        fingerprint: 'f'.repeat(64),
        pairedAt: '2026-07-15T12:00:00.000Z',
      })),
    };
    const queue = new PrivilegedServerQueue({
      commandProcessor: { process: vi.fn() } as never,
      pairingService: pairingService as never,
      pb: pb as never,
    });

    await queue.drain();

    expect(pairingService.completePairing).not.toHaveBeenCalled();
    expect(updatePairing).toHaveBeenCalledWith(
      'pairing-record',
      expect.objectContaining({ state: 'failed' }),
      { requestKey: null },
    );
  });

  it('terminally rejects malformed pending commands without aborting the queue drain', async () => {
    const malformedCommand = {
      id: 'malformed-command',
      ...envelope,
      operatorId: 'operator-1',
      bodyHash: 'b'.repeat(64),
      hasExpectedRevision: false,
      payload: { deeply: { nested: { value: undefined } } },
      state: 'pending',
    };
    const updateCommand = vi.fn(async () => ({}));
    const pb = {
      collection: vi.fn((name: string) => ({
        getFullList: vi.fn(async () =>
          name === RELAY_PRIVILEGED_COMMANDS_COLLECTION ? [malformedCommand] : [],
        ),
        update: updateCommand,
      })),
    };
    const processor = { process: vi.fn() };
    const queue = new PrivilegedServerQueue({
      commandProcessor: processor as never,
      pairingService: { completePairing: vi.fn() } as never,
      pb: pb as never,
    });

    await expect(queue.drain()).resolves.toBeUndefined();

    expect(processor.process).not.toHaveBeenCalled();
    expect(updateCommand).toHaveBeenCalledWith(
      'malformed-command',
      expect.objectContaining({
        state: 'failed',
        result: null,
        safeError: 'invalid-request',
      }),
      { requestKey: null },
    );
  });

  it('restores PocketBase date serialization before validating a signed command', async () => {
    const persistedCommand = {
      id: 'command-record',
      ...envelope,
      issuedAt: '2026-07-15 12:00:00.000Z',
      expiresAt: '2026-07-15 12:01:00.000Z',
      operatorId: 'operator-1',
      bodyHash: 'b'.repeat(64),
      hasExpectedRevision: false,
      state: 'pending',
    };
    const processor = {
      process: vi.fn(async () => ({ ok: true, requestId: 'request-1', value: {} })),
    };
    const pb = {
      collection: vi.fn((name: string) => ({
        getFullList: vi.fn(async () =>
          name === RELAY_PRIVILEGED_COMMANDS_COLLECTION ? [persistedCommand] : [],
        ),
        update: vi.fn(async () => ({})),
      })),
    };
    const queue = new PrivilegedServerQueue({
      commandProcessor: processor as never,
      pairingService: { completePairing: vi.fn() } as never,
      pb: pb as never,
    });

    await queue.drain();

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedAt: '2026-07-15T12:00:00.000Z',
        expiresAt: '2026-07-15T12:01:00.000Z',
      }),
    );
  });

  it('terminally stores safe processor rejections instead of rescanning them forever', async () => {
    const commandRecord = {
      id: 'rejected-command',
      ...envelope,
      operatorId: 'operator-1',
      bodyHash: 'b'.repeat(64),
      hasExpectedRevision: false,
      state: 'pending',
    };
    const updateCommand = vi.fn(async () => ({}));
    const pb = {
      collection: vi.fn((name: string) => ({
        getFullList: vi.fn(async () =>
          name === RELAY_PRIVILEGED_COMMANDS_COLLECTION ? [commandRecord] : [],
        ),
        update: updateCommand,
      })),
    };
    const queue = new PrivilegedServerQueue({
      commandProcessor: {
        process: vi.fn(async () => ({
          ok: false as const,
          requestId: 'request-1',
          error: 'pairing-required' as const,
        })),
      } as never,
      pairingService: { completePairing: vi.fn() } as never,
      pb: pb as never,
    });

    await queue.drain();

    expect(updateCommand).toHaveBeenCalledWith(
      'rejected-command',
      expect.objectContaining({ state: 'failed', safeError: 'pairing-required' }),
      { requestKey: null },
    );
  });

  it('fences new work and waits for an in-flight drain during disposal', async () => {
    let finishProcessing: (() => void) | undefined;
    const processing = new Promise<void>((resolve) => {
      finishProcessing = resolve;
    });
    const commandRecord = {
      id: 'command-record',
      ...envelope,
      operatorId: 'operator-1',
      bodyHash: 'b'.repeat(64),
      hasExpectedRevision: false,
      state: 'pending',
    };
    const unsubscribe = vi.fn(async () => undefined);
    const getFullList = vi.fn(async () => [commandRecord]);
    const pb = {
      collection: vi.fn(() => ({ getFullList, unsubscribe, update: vi.fn() })),
    };
    const queue = new PrivilegedServerQueue({
      commandProcessor: {
        process: vi.fn(async () => {
          await processing;
          return { ok: true as const, requestId: 'request-1', value: {} };
        }),
      } as never,
      pairingService: { completePairing: vi.fn() } as never,
      pb: pb as never,
    });

    const drain = queue.drain();
    await vi.waitFor(() => expect(getFullList).toHaveBeenCalled());
    let disposed = false;
    const disposal = queue.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    finishProcessing?.();
    await expect(Promise.all([drain, disposal])).resolves.toEqual([undefined, undefined]);
    getFullList.mockClear();
    await queue.drain();
    expect(getFullList).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});
