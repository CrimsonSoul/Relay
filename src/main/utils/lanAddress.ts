import { networkInterfaces } from 'node:os';

/** The first non-internal IPv4 address on this machine, if any. */
export function findLanIpv4Address(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find((entry) => entry.family === 'IPv4' && !entry.internal);
    if (address) return address.address;
  }
  return undefined;
}
