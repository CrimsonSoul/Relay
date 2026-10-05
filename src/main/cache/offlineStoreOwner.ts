import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { replaceFileDurablySync } from '../utils/durableFile';

const OWNER_FILE = 'offline-store-owner.json';
const STORE_FILES = ['cache.db', 'pending_changes.db'].flatMap((name) => [
  name,
  `${name}-wal`,
  `${name}-shm`,
]);
type Owner = { serverUrl: string | null; quarantine?: string };

function readOwner(dataDir: string): Owner | undefined {
  const path = join(dataDir, OWNER_FILE);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as Owner;
  if (
    !value ||
    (value.serverUrl !== null && typeof value.serverUrl !== 'string') ||
    (value.quarantine !== undefined && !/^offline-quarantine-[a-f0-9-]{36}$/.test(value.quarantine))
  ) {
    throw new Error(
      'Offline store ownership is unreadable. Preserve the local data directory before reconnecting.',
    );
  }
  return value;
}
function writeOwner(dataDir: string, owner: Owner): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, OWNER_FILE);
  // An unflushed record can survive a power loss as zeros, and unreadable ownership keeps the
  // offline cache closed on every later start.
  replaceFileDurablySync(`${path}.tmp`, path, JSON.stringify(owner), { mode: 0o600 });
}
export function readOfflineStoreOwner(dataDir: string): string | null | undefined {
  return readOwner(dataDir)?.serverUrl;
}
/** Record provenance before config.json is cleared or replaced, without retaining a secret. */
export function rememberOfflineStoreOwner(dataDir: string, serverUrl: string | null): void {
  if (readOwner(dataDir)) return;
  if (serverUrl === null && !STORE_FILES.some((file) => existsSync(join(dataDir, file)))) return;
  writeOwner(dataDir, { serverUrl });
}
/** Called only after old runtime handles close, before opening or replaying any client store. */
export function prepareClientOfflineStore(dataDir: string, serverUrl: string): void {
  let owner = readOwner(dataDir);
  const hasStore = STORE_FILES.some((file) => existsSync(join(dataDir, file)));
  if (owner && (owner.quarantine || (owner.serverUrl !== serverUrl && hasStore))) {
    const quarantine = owner.quarantine ?? `offline-quarantine-${randomUUID()}`;
    // Persist the destination first so an interrupted move resumes in the same directory.
    owner = { ...owner, quarantine };
    writeOwner(dataDir, owner);
    const destination = join(dataDir, quarantine);
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const file of STORE_FILES) {
      const source = join(dataDir, file);
      if (existsSync(source)) renameSync(source, join(destination, file));
    }
  }
  // An unmarked legacy store is attributed only during startup of its still-saved config.
  // Config replacement first records the previous target (or explicitly unknown ownership).
  if (owner?.serverUrl === serverUrl && !owner.quarantine) return;
  writeOwner(dataDir, { serverUrl });
}
