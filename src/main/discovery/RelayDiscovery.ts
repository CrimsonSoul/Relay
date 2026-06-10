import { hostname } from 'node:os';
import { Bonjour } from 'bonjour-service';
import type { DiscoveredRelayServer } from '@shared/ipc';
import { isLanRelayServerUrl } from '@shared/urlSecurity';
import { loggers } from '../logger';

const SERVICE_TYPE = 'relay';
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

let advertiser: Bonjour | null = null;

/** Swallow async mDNS errors so they log instead of crashing the main process. */
function logMdnsError(err: unknown): void {
  loggers.main.warn('mDNS error', { error: err });
}

/**
 * The underlying multicast-dns emitter emits 'error' on socket failures
 * (e.g. EACCES/EADDRINUSE on port 5353). bonjour-service attaches no listener,
 * so an unhandled emit would crash the main process. Attach one ourselves.
 */
function muzzleMdnsErrors(instance: Bonjour): void {
  const mdns = (instance as unknown as { server?: { mdns?: NodeJS.EventEmitter } }).server?.mdns;
  mdns?.on('error', (err: unknown) => {
    loggers.main.warn('mDNS socket error', { error: err });
  });
}

/** Advertise this server-mode instance as _relay._tcp on the LAN. Idempotent. */
export function startAdvertising(port: number): void {
  if (advertiser) return;
  try {
    advertiser = new Bonjour(undefined, logMdnsError);
    muzzleMdnsErrors(advertiser);
    advertiser.publish({ name: `Relay on ${hostname()}`, type: SERVICE_TYPE, port });
    loggers.main.info('mDNS advertising started', { port });
  } catch (err) {
    // mDNS is best-effort — manual URL entry always works.
    loggers.main.warn('Failed to start mDNS advertising', { error: err });
    const failed = advertiser;
    advertiser = null;
    try {
      failed?.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

export function stopAdvertising(): void {
  if (!advertiser) return;
  try {
    advertiser.unpublishAll();
  } catch (err) {
    loggers.main.warn('Failed to unpublish mDNS services', { error: err });
  }
  try {
    advertiser.destroy();
  } catch (err) {
    loggers.main.warn('Failed to stop mDNS advertising', { error: err });
  }
  advertiser = null;
}

/** Browse for relay services for `timeoutMs`, returning unique IPv4 results. */
export function discoverServers(timeoutMs = 3000): Promise<DiscoveredRelayServer[]> {
  return new Promise((resolve) => {
    let bonjour: Bonjour;
    try {
      bonjour = new Bonjour(undefined, logMdnsError);
      muzzleMdnsErrors(bonjour);
    } catch (err) {
      loggers.main.warn('Failed to start mDNS discovery', { error: err });
      resolve([]);
      return;
    }

    const found = new Map<string, DiscoveredRelayServer>();
    const browser = bonjour.find({ type: SERVICE_TYPE }, (service) => {
      const addresses: string[] = (service as { addresses?: string[] }).addresses ?? [];
      const port = (service as { port?: number }).port;
      const name = (service as { name?: string }).name ?? 'Relay server';
      if (!port) return;
      // mDNS records are attacker-controlled — only accept private/loopback IPv4
      // so a malicious advertiser can't present a WAN address as "on this network".
      const host = addresses.find(
        (a) => IPV4_RE.test(a) && isLanRelayServerUrl(`http://${a}:${port}`),
      );
      if (!host) return;
      found.set(`${host}:${port}`, { name, host, port, url: `http://${host}:${port}` });
    });

    setTimeout(() => {
      try {
        browser.stop();
        bonjour.destroy();
      } catch {
        // best-effort cleanup
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
