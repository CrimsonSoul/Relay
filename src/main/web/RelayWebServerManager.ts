import type { ServerConfig } from '../config/AppConfig';
import { DEFAULT_SERVER_WEB_CONFIG } from '../config/AppConfig';
import { RelayWebServer, type RelayWebServerOptions } from './RelayWebServer';
import type { RelayWebServerState } from './RelayWebServerState';
import type { RelayWebGatewayPort } from './RelayWebGateway';

type ManagedRelayWebServer = Pick<RelayWebServer, 'getState' | 'start' | 'stop'>;

type RelayWebServerManagerOptions = {
  staticRoot: string;
  createServer?: (options: RelayWebServerOptions) => ManagedRelayWebServer;
  createGateway?: (config: ServerConfig) => RelayWebGatewayPort;
  onStateChanged?: (state: RelayWebServerState) => void;
};

export class RelayWebServerManager {
  private readonly createServer: NonNullable<RelayWebServerManagerOptions['createServer']>;
  private server: ManagedRelayWebServer | null = null;
  private gateway: RelayWebGatewayPort | null = null;
  private lifecycle: Promise<void> = Promise.resolve();
  private config: ServerConfig | null = null;
  private state: RelayWebServerState = {
    status: 'disabled',
    host: '0.0.0.0',
    port: DEFAULT_SERVER_WEB_CONFIG.port,
  };

  constructor(private readonly options: RelayWebServerManagerOptions) {
    this.createServer =
      options.createServer ?? ((serverOptions) => new RelayWebServer(serverOptions));
  }

  getState(): RelayWebServerState {
    return { ...this.state };
  }

  async applyConfig(config: ServerConfig): Promise<RelayWebServerState> {
    return this.serialize(() => this.applyConfigExclusive(config));
  }

  private async applyConfigExclusive(config: ServerConfig): Promise<RelayWebServerState> {
    await this.stopServer();
    this.config = config;
    const web = config.web ?? DEFAULT_SERVER_WEB_CONFIG;
    if (!web.enabled) {
      this.publish({ status: 'disabled', host: config.bindHost, port: web.port });
      return this.getState();
    }

    const gateway = this.options.createGateway?.(config) ?? null;
    this.gateway = gateway;
    const server = this.createServer({
      host: config.bindHost,
      port: web.port,
      staticRoot: this.options.staticRoot,
      onStateChanged: (state) => this.publish(state),
      ...(gateway ? { gateway } : {}),
    });
    this.server = server;
    const state = await server.start();
    this.publish(state);
    return this.getState();
  }

  async retry(): Promise<RelayWebServerState> {
    return this.serialize(() =>
      this.config ? this.applyConfigExclusive(this.config) : Promise.resolve(this.getState()),
    );
  }

  async stop(): Promise<void> {
    return this.serialize(() => this.stopExclusive());
  }

  private async stopExclusive(): Promise<void> {
    await this.stopServer();
    const web = this.config?.web ?? DEFAULT_SERVER_WEB_CONFIG;
    this.publish({
      status: 'disabled',
      host: this.config?.bindHost ?? '0.0.0.0',
      port: web.port,
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    const gateway = this.gateway;
    this.server = null;
    this.gateway = null;
    try {
      await server?.stop();
    } finally {
      await gateway?.dispose();
    }
  }

  private publish(state: RelayWebServerState): void {
    this.state = { ...state };
    this.options.onStateChanged?.(this.getState());
  }
}
