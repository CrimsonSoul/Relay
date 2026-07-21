import { isIP } from 'node:net';
import type { PrivilegedCapability, PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedRuntime } from '../privileged/privilegedRuntime';
import type { ProductionPrivilegedHost } from '../privileged/ProductionPrivilegedHost';
import type { WebSessionStore } from './WebSessionStore';

export type SafeWebPrivilegedSource = {
  browserFamily: 'Chrome' | 'Edge' | 'Safari' | 'Other';
  addressLabel: string;
};

type WebPrivilegedSessionOptions = {
  sessionId: string;
  host: ProductionPrivilegedHost;
  sessions: WebSessionStore;
  userAgent: string;
  remoteAddress: string;
  onDispose?: () => void;
};

function disposeRejectedSession(host: ProductionPrivilegedHost, sessionId: string): void {
  void host.disposeWebRuntime(sessionId);
}

function browserFamily(userAgent: string): SafeWebPrivilegedSource['browserFamily'] {
  if (/\bEdg\//u.test(userAgent)) return 'Edge';
  if (/\b(?:Chrome|CriOS)\//u.test(userAgent)) return 'Chrome';
  if (/\bSafari\//u.test(userAgent)) return 'Safari';
  return 'Other';
}

export class WebPrivilegedSession {
  readonly runtime: PrivilegedRuntime;
  readonly source: SafeWebPrivilegedSource;
  private readonly stopSessionEvents: () => void;
  private disposePromise: Promise<void> | null = null;

  constructor(private readonly options: WebPrivilegedSessionOptions) {
    this.source = WebPrivilegedSession.safeSource(options.userAgent, options.remoteAddress);
    this.runtime = options.host.createWebRuntime({
      sessionId: options.sessionId,
      source: this.source,
    });
    this.stopSessionEvents = this.runtime.onSessionChanged((view) => {
      options.sessions.publish(options.sessionId, 'privileged-session-changed', view);
    });
    const registered = options.sessions.registerCleanup(options.sessionId, () => this.dispose());
    if (!registered) {
      this.stopSessionEvents();
      disposeRejectedSession(options.host, options.sessionId);
      throw new TypeError('Ordinary web session is unavailable.');
    }
  }

  static safeSource(userAgent: string, remoteAddress: string): SafeWebPrivilegedSource {
    const family = browserFamily(userAgent);
    const mappedAddress = remoteAddress.startsWith('::ffff:')
      ? remoteAddress.slice('::ffff:'.length)
      : remoteAddress;
    const addressLabel = isIP(mappedAddress) ? mappedAddress.slice(0, 128) : 'LAN/VPN client';
    return { browserFamily: family, addressLabel };
  }

  get sourceLabel(): string {
    return `${this.source.browserFamily} from ${this.source.addressLabel}`;
  }

  getView(): PrivilegedSessionView {
    return this.runtime.getView();
  }

  authorize(capability: PrivilegedCapability): boolean {
    const view = this.getView();
    return view.state === 'active' && view.capabilities.includes(capability);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.stopSessionEvents();
    this.options.host.approvalCodes.clearSession(this.options.sessionId);
    this.options.onDispose?.();
    this.disposePromise = this.options.host.disposeWebRuntime(this.options.sessionId);
    return this.disposePromise;
  }
}
