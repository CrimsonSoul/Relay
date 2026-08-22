import type { RelayWebServerPublicState } from '@shared/ipc';

export type RelayWebServerStatus = RelayWebServerPublicState['status'];

export type RelayWebServerState = {
  status: RelayWebServerStatus;
  host: string;
  port: number;
  url?: string;
  error?: Exclude<RelayWebServerPublicState['error'], 'unavailable'>;
};
