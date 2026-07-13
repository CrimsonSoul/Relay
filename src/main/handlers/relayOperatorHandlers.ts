import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type PocketBase from 'pocketbase';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  type IpcResult,
  type RelayOperatorActiveInput,
  type RelayOperatorCreateInput,
  type RelayOperatorRenameInput,
} from '@shared/ipc';
import type { RelayOperatorRecord } from '@shared/operators';
import { getErrorMessage } from '@shared/types';
import { RelayOperatorManager } from '../operators/RelayOperatorManager';

const boundedString = z.string().trim().min(1).max(128);
const displayName = z.string().max(1024);
const createSchema = z.object({ displayName }).strict();
const renameSchema = z
  .object({ id: boundedString, displayName, expectedUpdated: boundedString })
  .strict();
const activeSchema = z
  .object({ id: boundedString, active: z.boolean(), expectedUpdated: boundedString })
  .strict();

type TrustedSenderCheck = (event: IpcMainInvokeEvent, channel: string) => boolean;

export type RelayOperatorHandlerOptions = {
  ipcMain: Pick<IpcMain, 'handle'>;
  isServer: () => boolean;
  getPbClient: () => PocketBase | null;
  assertTrustedIpcSender: TrustedSenderCheck;
};

function failure<T = void>(error: unknown): IpcResult<T> {
  return { success: false, error: getErrorMessage(error) };
}

function invalidRequest<T>(): IpcResult<T> {
  return failure('Invalid Relay operator request.');
}

function getReadySuperuserClient(getPbClient: () => PocketBase | null): PocketBase | null {
  const pb = getPbClient();
  if (!pb?.authStore.isValid || pb.authStore.record?.collectionName !== '_superusers') return null;
  return pb;
}

export function setupRelayOperatorHandlers({
  ipcMain,
  isServer,
  getPbClient,
  assertTrustedIpcSender,
}: RelayOperatorHandlerOptions): void {
  ipcMain.handle(
    IPC_CHANNELS.RELAY_OPERATOR_CREATE,
    async (event, input: unknown): Promise<IpcResult<RelayOperatorRecord>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.RELAY_OPERATOR_CREATE)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Manage operators on the Relay server.');
      const pb = getReadySuperuserClient(getPbClient);
      if (!pb) return failure('Relay operator management is unavailable.');
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) return invalidRequest();

      try {
        const data = await new RelayOperatorManager(pb).create(
          parsed.data satisfies RelayOperatorCreateInput,
        );
        return { success: true, data };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RELAY_OPERATOR_RENAME,
    async (event, input: unknown): Promise<IpcResult<RelayOperatorRecord>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.RELAY_OPERATOR_RENAME)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Manage operators on the Relay server.');
      const pb = getReadySuperuserClient(getPbClient);
      if (!pb) return failure('Relay operator management is unavailable.');
      const parsed = renameSchema.safeParse(input);
      if (!parsed.success) return invalidRequest();

      try {
        const data = await new RelayOperatorManager(pb).rename(
          parsed.data satisfies RelayOperatorRenameInput,
        );
        return { success: true, data };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE,
    async (event, input: unknown): Promise<IpcResult<RelayOperatorRecord>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Manage operators on the Relay server.');
      const pb = getReadySuperuserClient(getPbClient);
      if (!pb) return failure('Relay operator management is unavailable.');
      const parsed = activeSchema.safeParse(input);
      if (!parsed.success) return invalidRequest();

      try {
        const data = await new RelayOperatorManager(pb).setActive(
          parsed.data satisfies RelayOperatorActiveInput,
        );
        return { success: true, data };
      } catch (error) {
        return failure(error);
      }
    },
  );
}
