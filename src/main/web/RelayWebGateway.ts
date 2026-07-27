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
  authorizeCapability?: NonNullable<
    ConstructorParameters<typeof WebRouter>[0]['authorizeCapability']
  >;
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

export class RelayWebGateway {
  private readonly sessions = new WebSessionStore();
  private readonly security: WebRequestSecurity;
  private readonly router: WebRouter;
  private readonly stopOperationalEvents: (() => void) | null;
  // Both maps are keyed on the stable logical session id. Keying them on the browser cookie
  // silently rebuilt a signed-out runtime after every /session/refresh rotation.
  private readonly privilegedSessions = new Map<string, WebPrivilegedSession>();
  private readonly knowledgeSessions = new Map<string, WebKnowledgeSession>();

  constructor(options: RelayWebGatewayOptions) {
    const hostname = options.hostname ?? getHostname();
    const getInterfaces = options.getInterfaceAddresses ?? activeInterfaceAddresses;
    this.security = new WebRequestSecurity({
      port: options.config.web?.port ?? 8091,
      hostname,
      getInterfaceAddresses: getInterfaces,
      // The PocketBase origin handed to the browser follows the host it actually reached, so
      // connect-src is derived per response from the same live interface list instead of a
      // boot-time snapshot that misses interfaces raised later (VPN, docking station).
      connectPort: options.config.port,
    });
    this.router = new WebRouter({
      security: this.security,
      sessions: this.sessions,
      authorizeCapability: (logicalSessionId, capability) =>
        this.privilegedSessions.get(logicalSessionId)?.authorize(capability) ??
        options.authorizeCapability?.(logicalSessionId, capability) ??
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
        getSession: (logicalSessionId, context) => {
          let privileged = this.privilegedSessions.get(logicalSessionId);
          if (!privileged) {
            privileged = new WebPrivilegedSession({
              logicalSessionId,
              host,
              sessions: this.sessions,
              userAgent:
                typeof context.request.headers['user-agent'] === 'string'
                  ? context.request.headers['user-agent']
                  : '',
              remoteAddress: context.remoteAddress,
              onDispose: () => this.privilegedSessions.delete(logicalSessionId),
            });
            this.privilegedSessions.set(logicalSessionId, privileged);
          }
          return { runtime: privileged.runtime, sourceLabel: privileged.sourceLabel };
        },
      });
    }
    if (options.knowledgeServices && options.knowledgeUploadRoot) {
      startPreparingKnowledgeRoot(options.knowledgeUploadRoot);
      registerKnowledgeRoutes(this.router, {
        services: options.knowledgeServices,
        getSession: (logicalSessionId) => {
          let knowledge = this.knowledgeSessions.get(logicalSessionId);
          if (knowledge) return knowledge;
          const privileged = this.privilegedSessions.get(logicalSessionId);
          if (!privileged?.authorize('knowledge.manage')) return null;
          knowledge = new WebKnowledgeSession({
            logicalSessionId,
            sessions: this.sessions,
            runtime: privileged.runtime,
            rootDir: options.knowledgeUploadRoot!,
            onDispose: () => this.knowledgeSessions.delete(logicalSessionId),
          });
          this.knowledgeSessions.set(logicalSessionId, knowledge);
          return knowledge;
        },
      });
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  authorizeStatic(request: IncomingMessage, response: ServerResponse): boolean {
    // Validate first: it refreshes the interface list, so the emitted connect-src reflects the
    // interfaces that just admitted this request rather than a stale snapshot.
    const network = this.security.validateNetwork(
      request.socket.remoteAddress,
      request.headers.host,
    );
    for (const [name, value] of Object.entries(this.security.responseHeaders())) {
      response.setHeader(name, value);
    }
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
