import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname as getHostname, networkInterfaces } from 'node:os';
import type { ServerConfig } from '../config/AppConfig';
import type { WebSessionCreateInput } from './WebSessionStore';
import { WebSessionStore } from './WebSessionStore';
import { WebRequestSecurity } from './WebRequestSecurity';
import { WebRouter } from './WebRouter';
import { registerOperationalRoutes, type OperationalServices } from './routes/operationalRoutes';
import { registerPrivilegedRoutes } from './routes/privilegedRoutes';
import { WebPrivilegedSession } from './WebPrivilegedSession';
import type { ProductionPrivilegedHost } from '../privileged/ProductionPrivilegedHost';
import type { PrivilegedAccountManager } from '../privileged/PrivilegedAccountManager';
import { registerWebSessionRoutes } from './routes/sessionRoutes';
import { registerKnowledgeRoutes, type KnowledgeRouteServices } from './routes/knowledgeRoutes';
import { WebKnowledgeSession } from './WebKnowledgeSession';
import { prepareWebKnowledgeUploadRoot } from './WebKnowledgeUploadStaging';

function startPreparingKnowledgeRoot(rootDir: string): void {
  void prepareWebKnowledgeUploadRoot(rootDir).catch(() => undefined);
}

type RelayWebGatewayOptions = {
  config: ServerConfig;
  authenticate: (passphrase: string) => Promise<WebSessionCreateInput | null>;
  hostname?: string;
  getInterfaceAddresses?: () => string[];
  operationalServices?: OperationalServices;
  authorizeCapability?: ConstructorParameters<typeof WebRouter>[0]['authorizeCapability'];
  privilegedHost?: ProductionPrivilegedHost | null;
  getAccountManager?: () => Pick<
    PrivilegedAccountManager,
    'setupInitialAdministrator' | 'setupCredential'
  > | null;
  knowledgeServices?: KnowledgeRouteServices;
  knowledgeUploadRoot?: string;
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
  private readonly stopOperationalEvents: (() => void) | null;
  private readonly privilegedSessions = new Map<string, WebPrivilegedSession>();
  private readonly knowledgeSessions = new Map<string, WebKnowledgeSession>();

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
    this.router = new WebRouter({
      security: this.security,
      sessions: this.sessions,
      authorizeCapability: (sessionId, capability) =>
        this.privilegedSessions.get(sessionId)?.authorize(capability) ??
        options.authorizeCapability?.(sessionId, capability) ??
        false,
    });
    registerWebSessionRoutes(this.router, {
      sessions: this.sessions,
      authenticate: options.authenticate,
    });
    if (options.operationalServices) {
      registerOperationalRoutes(this.router, {
        services: options.operationalServices,
        sessions: this.sessions,
      });
      this.stopOperationalEvents =
        options.operationalServices.dashboards.onChange?.((dashboards) => {
          this.sessions.publishAll('dynatrace-dashboards-changed', dashboards);
        }) ?? null;
    } else {
      this.stopOperationalEvents = null;
    }
    if (options.privilegedHost) {
      const host = options.privilegedHost;
      registerPrivilegedRoutes(this.router, {
        approvalCodes: host.approvalCodes,
        getAccountManager: options.getAccountManager ?? (() => null),
        getSession: (sessionId, context) => {
          let privileged = this.privilegedSessions.get(sessionId);
          if (!privileged) {
            privileged = new WebPrivilegedSession({
              sessionId,
              host,
              sessions: this.sessions,
              userAgent:
                typeof context.request.headers['user-agent'] === 'string'
                  ? context.request.headers['user-agent']
                  : '',
              remoteAddress: context.remoteAddress,
              onDispose: () => this.privilegedSessions.delete(sessionId),
            });
            this.privilegedSessions.set(sessionId, privileged);
          }
          return { runtime: privileged.runtime, sourceLabel: privileged.sourceLabel };
        },
      });
    }
    if (options.knowledgeServices && options.knowledgeUploadRoot) {
      startPreparingKnowledgeRoot(options.knowledgeUploadRoot);
      registerKnowledgeRoutes(this.router, {
        services: options.knowledgeServices,
        getSession: (sessionId) => {
          let knowledge = this.knowledgeSessions.get(sessionId);
          if (knowledge) return knowledge;
          const privileged = this.privilegedSessions.get(sessionId);
          if (!privileged?.authorize('knowledge.manage')) return null;
          knowledge = new WebKnowledgeSession({
            sessionId,
            sessions: this.sessions,
            runtime: privileged.runtime,
            rootDir: options.knowledgeUploadRoot!,
            onDispose: () => this.knowledgeSessions.delete(sessionId),
          });
          this.knowledgeSessions.set(sessionId, knowledge);
          return knowledge;
        },
      });
    }
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
    this.stopOperationalEvents?.();
    await this.sessions.dispose();
    this.privilegedSessions.clear();
    this.knowledgeSessions.clear();
  }
}
