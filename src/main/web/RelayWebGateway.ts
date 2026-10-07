import { SDP_FEATURES_HEADER, SdpBrokerCommandSchema } from '@shared/sdpAccount';
import { RELAY_WEB_API_PREFIX, WebRadarSnapshotSchema } from '@shared/webApi';
import { acceptsSdpVip, withoutSdpVip, type SdpBroker } from '../sdp/SdpBroker';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

// Async work stays out of the constructor (sonarjs/no-async-constructor).
function startPreparingKnowledgeRoot(rootDir: string): void {
  void prepareWebKnowledgeUploadRoot(rootDir).catch(() => undefined);
}

type RelayWebGatewayOptions = {
  getSdpBroker?: () => SdpBroker | null;
  /** Development-only SDP test actions (clearCopies, readTestTicket); release builds pass false. */
  allowSdpTestControls?: boolean;
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

export class RelayWebGateway {
  private readonly sessions = new WebSessionStore();
  private readonly security: WebRequestSecurity;
  private readonly router: WebRouter;
  private readonly stopOperationalEvents: Array<() => void> = [];
  // Both maps are keyed on the stable logical session id. Keying them on the browser cookie
  // silently rebuilt a signed-out runtime after every /session/refresh rotation.
  private readonly privilegedSessions = new Map<string, WebPrivilegedSession>();
  private readonly knowledgeSessions = new Map<string, WebKnowledgeSession>();

  constructor(options: RelayWebGatewayOptions) {
    this.security = new WebRequestSecurity({
      port: options.config.web?.port ?? 8091,
      hostname: options.hostname,
      getInterfaceAddresses: options.getInterfaceAddresses,
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
    if (options.getSdpBroker) {
      this.sessions.onDestroyed((id) => {
        options.getSdpBroker?.()?.disconnect(id);
      });
      this.router.register({
        method: 'POST',
        path: `${RELAY_WEB_API_PREFIX}/sdp/account`,
        authenticated: true,
        csrf: true,
        bodySchema: SdpBrokerCommandSchema,
        maxBodyBytes: 15 * 1024 * 1024,
        // Matches the desktop client's reply bound: a queue monitor snapshot of up to 1,000 tickets
        // per queue, or a bounded 10 MiB attachment, exceeds the default response bound.
        maxResponseBytes: 15 * 1024 * 1024,
        // Fast triage from a desktop client reads a ticket and its panels every few seconds on top
        // of its status and alert checks; the broker still runs one operation at a time per session.
        rateLimit: { bucket: 'sdp-account', key: 'session', limit: 240, windowMs: 60_000 },
        handler: async ({ logicalSessionId, body, request }) => {
          try {
            const broker = options.getSdpBroker?.();
            if (!broker || !logicalSessionId)
              return { status: 503, body: { error: 'SDP is unavailable.' } };
            if (
              !options.allowSdpTestControls &&
              (body.action === 'clearCopies' || body.action === 'readTestTicket')
            )
              return { status: 404, body: { error: 'Test controls are unavailable.' } };
            const reply = await broker.invoke(logicalSessionId, body);
            // Older desktop clients reject ticket fields they do not know.
            return {
              status: 200,
              body: acceptsSdpVip(request.headers[SDP_FEATURES_HEADER])
                ? reply
                : withoutSdpVip(reply),
            };
          } catch {
            return { status: 502, body: { error: 'SDP could not complete this action.' } };
          }
        },
      });
    }
    registerWebSessionRoutes(this.router, {
      sessions: this.sessions,
      authenticate: options.authenticate,
    });
    if (options.operationalServices) {
      registerOperationalRoutes(this.router, {
        services: options.operationalServices,
        sessions: this.sessions,
      });
      const stopDashboards = options.operationalServices.dashboards.onChange?.((dashboards) => {
        this.sessions.publishAll('dynatrace-dashboards-changed', dashboards);
      });
      if (stopDashboards) this.stopOperationalEvents.push(stopDashboards);
      const stopRadar = options.operationalServices.radar.onChange?.((snapshot) => {
        const parsed = WebRadarSnapshotSchema.safeParse(snapshot);
        if (parsed.success) this.sessions.publishAll('radar-snapshot-changed', parsed.data);
      });
      if (stopRadar) this.stopOperationalEvents.push(stopRadar);
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
      const stopIndexStatus = options.knowledgeServices.index.onChange?.((status) => {
        // Same audience as GET /knowledge/index-status: every signed-in session.
        this.sessions.publishAll('knowledge-index-status-changed', status);
      });
      if (stopIndexStatus) this.stopOperationalEvents.push(stopIndexStatus);
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
    for (const stop of this.stopOperationalEvents.splice(0)) stop();
    await this.sessions.dispose();
    this.privilegedSessions.clear();
    this.knowledgeSessions.clear();
  }
}
