import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname as getHostname, networkInterfaces } from 'node:os';
import type { ServerConfig } from '../config/AppConfig';
import type { WebSessionCreateInput } from './WebSessionStore';
import { WebSessionStore } from './WebSessionStore';
import { WebRequestSecurity } from './WebRequestSecurity';
import { WebRouter } from './WebRouter';
import { registerWebSessionRoutes } from './routes/sessionRoutes';

type RelayWebGatewayOptions = {
  config: ServerConfig;
  authenticate: (passphrase: string) => Promise<WebSessionCreateInput | null>;
  hostname?: string;
  getInterfaceAddresses?: () => string[];
};

export type RelayWebGatewayPort = Pick<
  RelayWebGateway,
  'authorizeStatic' | 'handleApi' | 'dispose'
>;

function activeInterfaceAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.address);
}

function formatHost(address: string): string {
  const normalized = address.trim().toLowerCase();
  return normalized.includes(':') ? `[${normalized}]` : normalized;
}

function origin(address: string, port: number): string {
  return ['http', '://', formatHost(address), ':', String(port)].join('');
}

export class RelayWebGateway {
  private readonly sessions = new WebSessionStore();
  private readonly security: WebRequestSecurity;
  private readonly router: WebRouter;

  constructor(options: RelayWebGatewayOptions) {
    const hostname = options.hostname ?? getHostname();
    const getInterfaces = options.getInterfaceAddresses ?? activeInterfaceAddresses;
    const interfaceAddresses = getInterfaces();
    this.security = new WebRequestSecurity({
      port: options.config.web?.port ?? 8091,
      hostname,
      getInterfaceAddresses: getInterfaces,
      connectOrigins: [
        origin(hostname, options.config.port),
        origin('localhost', options.config.port),
        origin('127.0.0.1', options.config.port),
        origin('::1', options.config.port),
        ...interfaceAddresses.map((address) => origin(address, options.config.port)),
      ],
    });
    this.router = new WebRouter({ security: this.security, sessions: this.sessions });
    registerWebSessionRoutes(this.router, {
      sessions: this.sessions,
      authenticate: options.authenticate,
    });
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  authorizeStatic(request: IncomingMessage, response: ServerResponse): boolean {
    for (const [name, value] of Object.entries(this.security.responseHeaders())) {
      response.setHeader(name, value);
    }
    const network = this.security.validateNetwork(
      request.socket.remoteAddress,
      request.headers.host,
    );
    if (network.ok) return true;
    response.statusCode = 403;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Forbidden');
    return false;
  }

  handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return this.router.handle(request, response);
  }

  async dispose(): Promise<void> {
    await this.sessions.dispose();
  }
}
