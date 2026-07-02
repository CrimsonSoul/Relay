/// <reference types="vite/client" />

import type { BridgeAPI } from '@shared/ipc';

declare global {
  var api: BridgeAPI | undefined;
  interface Window {
    api?: BridgeAPI;
  }
}

export {};
