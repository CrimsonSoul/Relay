import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_COVER_BYTES,
  isKnowledgeChecksum,
  normalizeKnowledgeDocumentRecord,
  type KnowledgeCoverRequest,
  type KnowledgeCoverResult,
} from '@shared/knowledge';
import { isAllowedRelayServerUrl } from '@shared/urlSecurity';
import type { RelayConfig } from '../config/AppConfig';
import type { KnowledgePdfService } from './KnowledgePdfService';

const CACHE_BUDGET_BYTES = 100 * 1024 * 1024;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type KnowledgeCoverServiceOptions = {
  configDataDir: string;
  getConfig: () => RelayConfig | null;
  getPbClient: () => PocketBase | null;
  getPdfService: () => KnowledgePdfService | null;
  createClient?: (url: string) => PocketBase;
  fetch?: typeof globalThis.fetch;
  renderCover?: (data: Uint8Array) => Promise<Uint8Array>;
  loadCoverRenderer?: () => Promise<{
    renderKnowledgeCover: (data: Uint8Array) => Promise<Uint8Array>;
  }>;
};

type CacheEntry = { path: string; checksum: string; size: number; modifiedAt: number };

function validPng(data: Uint8Array): boolean {
  return (
    data.byteLength >= PNG_SIGNATURE.length &&
    data.byteLength <= KNOWLEDGE_MAX_COVER_BYTES &&
    PNG_SIGNATURE.every((value, index) => data[index] === value)
  );
}

function arrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maximumBytes ? bytes : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class KnowledgeCoverService {
  private readonly cacheDir: string;
  private readonly getConfig: () => RelayConfig | null;
  private readonly getPbClient: () => PocketBase | null;
  private readonly getPdfService: () => KnowledgePdfService | null;
  private readonly createClient: (url: string) => PocketBase;
  private readonly fetchCover: typeof globalThis.fetch;
  private readonly renderCover: (data: Uint8Array) => Promise<Uint8Array>;
  private readonly inFlight = new Map<string, Promise<KnowledgeCoverResult>>();
  private readonly waiters: Array<() => void> = [];
  private activeJobs = 0;
  private client: PocketBase | null = null;

  constructor(options: KnowledgeCoverServiceOptions) {
    this.cacheDir = join(options.configDataDir, 'knowledge-cover-cache');
    this.getConfig = options.getConfig;
    this.getPbClient = options.getPbClient;
    this.getPdfService = options.getPdfService;
    this.createClient = options.createClient ?? ((url) => new PocketBase(url));
    this.fetchCover = options.fetch ?? globalThis.fetch;
    if (options.renderCover) {
      this.renderCover = options.renderCover;
    } else {
      const loadCoverRenderer = options.loadCoverRenderer ?? (() => import('./knowledgeCover'));
      let renderer: Promise<(data: Uint8Array) => Promise<Uint8Array>> | null = null;
      this.renderCover = async (data) => {
        renderer ??= loadCoverRenderer().then((module) => module.renderKnowledgeCover);
        return (await renderer)(data);
      };
    }
  }

  getCover(request: KnowledgeCoverRequest): Promise<KnowledgeCoverResult> {
    if (
      !/^[A-Za-z0-9]{1,200}$/.test(request.documentId) ||
      !isKnowledgeChecksum(request.checksum)
    ) {
      return Promise.resolve({ ok: false, error: 'invalid-document' });
    }
    const existing = this.inFlight.get(request.checksum);
    if (existing) return existing;
    const operation = this.withPermit(() => this.loadCover(request)).finally(() => {
      this.inFlight.delete(request.checksum);
    });
    this.inFlight.set(request.checksum, operation);
    return operation;
  }

  async cleanup(referencedChecksums: Set<string>): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const entries = await this.cacheEntries();
    let retained = entries;
    for (const entry of entries) {
      if (!referencedChecksums.has(entry.checksum)) {
        await rm(entry.path, { force: true });
        retained = retained.filter(({ path }) => path !== entry.path);
      }
    }
    let total = retained.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of retained.toSorted((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (total <= CACHE_BUDGET_BYTES) break;
      await rm(entry.path, { force: true });
      total -= entry.size;
    }
  }

  private async loadCover(request: KnowledgeCoverRequest): Promise<KnowledgeCoverResult> {
    const cached = await this.readCache(request.checksum);
    if (cached) return this.success(cached, request.checksum, 'cache');
    const config = this.getConfig();
    if (!config) return { ok: false, error: 'invalid-document' };

    const stored = await this.readStoredCover(config, request);
    if (stored) {
      await this.promoteCache(request.checksum, stored.data);
      return this.success(stored.data, request.checksum, stored.source);
    }

    const pdf = await this.getPdfService()?.getPdf(request);
    if (!pdf?.ok) {
      return {
        ok: false,
        error: pdf?.error === 'not-available-offline' ? 'not-available-offline' : 'download-failed',
      };
    }
    try {
      const cover = await this.renderCover(new Uint8Array(pdf.data));
      if (!validPng(cover)) return { ok: false, error: 'render-failed' };
      await this.promoteCache(request.checksum, cover);
      return this.success(cover, request.checksum, 'generated');
    } catch {
      return { ok: false, error: 'render-failed' };
    }
  }

  private async readStoredCover(
    config: RelayConfig,
    request: KnowledgeCoverRequest,
  ): Promise<{ data: Uint8Array; source: 'server' | 'download' } | null> {
    let pb = config.mode === 'server' ? this.getPbClient() : null;
    if (config.mode === 'client') {
      if (!isAllowedRelayServerUrl(config.serverUrl, config.allowInsecureHttp === true))
        return null;
      pb = this.client ?? this.createClient(config.serverUrl);
      this.client = pb;
      try {
        await pb.health.check({ requestKey: null });
        if (!pb.authStore.isValid) {
          await pb
            .collection('_pb_users_auth_')
            .authWithPassword(RELAY_APP_USER_EMAIL, config.secret, {
              requestKey: null,
            });
        }
      } catch {
        return null;
      }
    }
    if (!pb) return null;
    try {
      const raw = await pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getOne(request.documentId, {
        requestKey: null,
      });
      const record = normalizeKnowledgeDocumentRecord(raw);
      if (record?.checksum !== request.checksum || !record.cover) return null;
      const token = await pb.files.getToken({ requestKey: null });
      const url = pb.files.getURL(raw, record.cover, { token });
      const data = await this.fetchBytes(url);
      if (!data || !validPng(data)) return null;
      return { data, source: config.mode === 'server' ? 'server' : 'download' };
    } catch {
      return null;
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    if (!url) return null;
    try {
      const response = await this.fetchCover(url);
      if (!response.ok) return null;
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > KNOWLEDGE_MAX_COVER_BYTES) return null;
      return await readBoundedResponse(response, KNOWLEDGE_MAX_COVER_BYTES);
    } catch {
      return null;
    }
  }

  private success(
    data: Uint8Array,
    checksum: string,
    source: 'server' | 'cache' | 'generated' | 'download',
  ): KnowledgeCoverResult {
    return { ok: true, data: arrayBuffer(data), checksum, source };
  }

  private async withPermit<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeJobs >= 2) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeJobs += 1;
    try {
      return await operation();
    } finally {
      this.activeJobs -= 1;
      this.waiters.shift()?.();
    }
  }

  private cachePath(checksum: string): string {
    return join(this.cacheDir, `${checksum}.png`);
  }

  private async readCache(checksum: string): Promise<Uint8Array | null> {
    const path = this.cachePath(checksum);
    try {
      const data = await readFile(path);
      if (!validPng(data)) {
        await rm(path, { force: true });
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  private async promoteCache(checksum: string, data: Uint8Array): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const destination = this.cachePath(checksum);
    const temporary = join(this.cacheDir, `${checksum}.${process.pid}.${Date.now()}.tmp`);
    try {
      await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
      await rm(destination, { force: true });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async cacheEntries(): Promise<CacheEntry[]> {
    const entries = await readdir(this.cacheDir, { withFileTypes: true });
    const result: CacheEntry[] = [];
    for (const entry of entries) {
      const match = /^([0-9a-f]{64})\.png$/.exec(entry.name);
      const path = join(this.cacheDir, entry.name);
      if (!match || !entry.isFile()) {
        if (entry.name.endsWith('.tmp')) await rm(path, { force: true });
        continue;
      }
      const details = await stat(path);
      result.push({
        path,
        checksum: match[1]!,
        size: details.size,
        modifiedAt: details.mtimeMs,
      });
    }
    return result;
  }
}
