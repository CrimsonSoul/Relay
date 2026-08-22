import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import type { RelayAdministrationSnapshot } from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';

export type AdministrationExecute = (
  request: PublicPrivilegedCommandRequest,
) => Promise<PrivilegedCommandResult>;

export type AdministrationPanelProps = {
  snapshot: RelayAdministrationSnapshot;
  execute: AdministrationExecute;
};
