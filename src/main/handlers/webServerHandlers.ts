import { ipcMain } from 'electron';
import { networkInterfaces } from 'node:os';
import { IPC_CHANNELS, type IpcResult, type RelayWebServerPublicState } from '@shared/ipc';
import { ServerWebConfigSchema } from '@shared/ipcValidation';
import { DEFAULT_SERVER_WEB_CONFIG, type AppConfig, type ServerConfig } from '../config/AppConfig';
import type { RelayWebServerManager } from '../web/RelayWebServerManager';
import type { RelayWebServerState } from '../web/RelayWebServerState';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const UNAVAILABLE_STATE: RelayWebServerPublicState = {
  enabled: false,
  status: 'failed',
  port: DEFAULT_SERVER_WEB_CONFIG.port,
  error: 'unavailable',
};

function findLanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((entry) => entry.family === 'IPv4' && !entry.internal);
    if (address) return address.address;
  }
  return undefined;
}

function formatUrlHost(address: string): string {
  return address.includes(':') ? `[${address}]` : address;
}

function toPublicState(
  config: ServerConfig,
  state: RelayWebServerState,
  lanAddress: string | undefined,
): RelayWebServerPublicState {
  const web = config.web ?? DEFAULT_SERVER_WEB_CONFIG;
  const result: RelayWebServerPublicState = {
    enabled: web.enabled,
    status: state.status,
    port: state.port,
  };
  if (state.error) result.error = state.error;
  if (state.status === 'available' && lanAddress) {
    result.url = `http://${formatUrlHost(lanAddress)}:${state.port}`;
  }
  return result;
}

type RelayWebServerHandlersOptions = {
  getAppConfig: () => AppConfig | null;
  getManager: () => RelayWebServerManager | null;
  getLanAddress?: () => string | undefined;
};

export function setupRelayWebServerHandlers({
  getAppConfig,
  getManager,
  getLanAddress = findLanAddress,
}: RelayWebServerHandlersOptions): void {
  const getServerConfig = (): ServerConfig | null => {
    const config = getAppConfig()?.load();
    return config?.mode === 'server' ? config : null;
  };

  const getState = (): RelayWebServerPublicState => {
    const config = getServerConfig();
    const manager = getManager();
    if (!config || !manager) return { ...UNAVAILABLE_STATE };
    return toPublicState(config, manager.getState(), getLanAddress());
  };

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_GET_STATE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WEB_SERVER_GET_STATE)) {
      return { ...UNAVAILABLE_STATE };
    }
    return getState();
  });

  ipcMain.handle(
    IPC_CHANNELS.WEB_SERVER_SAVE_CONFIG,
    async (event, input: unknown): Promise<IpcResult<RelayWebServerPublicState>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.WEB_SERVER_SAVE_CONFIG)) {
        return { success: false, error: 'Relay Web is unavailable.' };
      }
      const parsed = ServerWebConfigSchema.safeParse(input);
      const appConfig = getAppConfig();
      const manager = getManager();
      if (!appConfig) return { success: false, error: 'Relay Web is unavailable.' };
      const current = appConfig.load();
      if (
        !parsed.success ||
        current?.mode !== 'server' ||
        parsed.data.port === current.port ||
        !manager ||
        !appConfig.updateServerWebConfig(parsed.data)
      ) {
        return { success: false, error: 'Invalid Relay Web configuration.' };
      }

      const nextConfig: ServerConfig = { ...current, web: { ...parsed.data } };
      const state = await manager.applyConfig(nextConfig);
      return {
        success: true,
        data: toPublicState(nextConfig, state, getLanAddress()),
      };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.WEB_SERVER_RETRY,
    async (event): Promise<IpcResult<RelayWebServerPublicState>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.WEB_SERVER_RETRY)) {
        return { success: false, error: 'Relay Web is unavailable.' };
      }
      const config = getServerConfig();
      const manager = getManager();
      if (!config || !manager) return { success: false, error: 'Relay Web is unavailable.' };
      const state = await manager.retry();
      return { success: true, data: toPublicState(config, state, getLanAddress()) };
    },
  );
}
