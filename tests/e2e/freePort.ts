import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

// Below the ephemeral ranges (Linux 32768+, macOS and Windows 49152+), so an outbound connection
// cannot take the port between this probe and PocketBase binding it.
const FIRST_PORT = 20_000;
const LAST_PORT = 32_767;

const isFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

/** A local TCP port that is free now and outside the operating system's ephemeral range. */
export async function freePort(exclude: readonly number[] = []): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = randomInt(FIRST_PORT, LAST_PORT + 1);
    if (!exclude.includes(port) && (await isFree(port))) return port;
  }
  throw new Error('No free local test port found.');
}
