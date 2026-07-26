import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_PDF_BYTES,
  isKnowledgeChecksum,
  normalizeKnowledgeDocumentRecord,
  type KnowledgeDocumentRecord,
  type KnowledgePdfRequest,
  type KnowledgePdfResult,
} from '@shared/knowledge';
import { isAllowedRelayServerUrl } from '@shared/urlSecurity';
import type { RelayConfig } from '../config/AppConfig';
import { authenticateRelayAppUserShared } from '../pocketbase/RelayAppUserAuthCoordinator';

const DEFAULT_CACHE_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_ORPHAN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const PDF_SIGNATURE = '%PDF-';

type KnowledgePdfServiceOptions = {
  configDataDir: string;
  getConfig: () => RelayConfig | null;
  getPbClient: () => PocketBase | null;
  createClient?: (url: string) => PocketBase;
  fetch?: typeof globalThis.fetch;
  cacheBudgetBytes?: number;
  orphanMaxAgeMs?: number;
  now?: () => number;
};

type CacheEntry = { path: string; checksum: string; size: number; modifiedAt: number };

function checksumOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function validPdfBytes(data: Uint8Array, record: KnowledgeDocumentRecord): boolean {
  return (
    data.byteLength > 0 &&
    data.byteLength <= KNOWLEDGE_MAX_PDF_BYTES &&
    data.byteLength === record.byteSize &&
    Buffer.from(data.subarray(0, PDF_SIGNATURE.length)).toString('ascii') === PDF_SIGNATURE &&
    checksumOf(data) === record.checksum
  );
}

function asKnowledgeRecord(value: unknown): KnowledgeDocumentRecord | null {
  return normalizeKnowledgeDocumentRecord(value);
}

export class KnowledgePdfService {
  private readonly cacheDir: string;
  private readonly getConfig: () => RelayConfig | null;
  private readonly getPbClient: () => PocketBase | null;
  private readonly createClient: (url: string) => PocketBase;
  private readonly fetchPdf: typeof globalThis.fetch;
  private readonly cacheBudgetBytes: number;
  private readonly orphanMaxAgeMs: number;
  private readonly now: () => number;
  private client: PocketBase | null = null;
  private activeChecksum: string | null = null;

  constructor(options: KnowledgePdfServiceOptions) {
    this.cacheDir = join(options.configDataDir, 'knowledge-cache');
    this.getConfig = options.getConfig;
    this.getPbClient = options.getPbClient;
    this.createClient = options.createClient ?? ((url) => new PocketBase(url));
    this.fetchPdf = options.fetch ?? globalThis.fetch;
    this.cacheBudgetBytes = options.cacheBudgetBytes ?? DEFAULT_CACHE_BUDGET_BYTES;
    this.orphanMaxAgeMs = options.orphanMaxAgeMs ?? DEFAULT_ORPHAN_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
  }

  setActiveChecksum(checksum: string | null): void {
    this.activeChecksum = checksum && isKnowledgeChecksum(checksum) ? checksum : null;
  }

  async getPdf(request: KnowledgePdfRequest): Promise<KnowledgePdfResult> {
    if (
      !/^[A-Za-z0-9]{1,200}$/.test(request.documentId) ||
      !isKnowledgeChecksum(request.checksum)
    ) {
      return { ok: false, error: 'invalid-document' };
    }

    const config = this.getConfig();
    if (!config) return { ok: false, error: 'invalid-document' };
    if (config.mode === 'client') {
      const cached = await this.readCache(request.checksum);
      if (cached) return this.success(cached, request.checksum, 'cache');
      return this.getClientPdf(config, request);
    }
    return this.getServerPdf(request);
  }

  async cleanup(referencedChecksums: Set<string>): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const entries = await this.readCacheEntries();
    const retained: CacheEntry[] = [];

    for (const entry of entries) {
      const isOrphan = !referencedChecksums.has(entry.checksum);
      const expired = this.now() - entry.modifiedAt >= this.orphanMaxAgeMs;
      if (isOrphan && expired && entry.checksum !== this.activeChecksum) {
        await rm(entry.path, { force: true });
      } else {
        retained.push(entry);
      }
    }

    let total = retained.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of retained.toSorted((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (total <= this.cacheBudgetBytes) break;
      if (entry.checksum === this.activeChecksum) continue;
      await rm(entry.path, { force: true });
      total -= entry.size;
    }
  }

  private success(
    data: Uint8Array,
    checksum: string,
    source: 'server' | 'cache' | 'download',
  ): KnowledgePdfResult {
    this.activeChecksum = checksum;
    return { ok: true, data: toArrayBuffer(data), checksum, source };
  }

  private async getServerPdf(request: KnowledgePdfRequest): Promise<KnowledgePdfResult> {
    const pb = this.getPbClient();
    if (!pb) return { ok: false, error: 'not-found' };
    const raw = await this.getRecord(pb, request.documentId);
    const record = asKnowledgeRecord(raw);
    if (record?.checksum !== request.checksum) {
      return { ok: false, error: 'invalid-document' };
    }

    return this.downloadProtectedPdf(pb, raw, record, false);
  }

  private async getClientPdf(
    config: Extract<RelayConfig, { mode: 'client' }>,
    request: KnowledgePdfRequest,
  ): Promise<KnowledgePdfResult> {
    if (!isAllowedRelayServerUrl(config.serverUrl, config.allowInsecureHttp === true)) {
      return { ok: false, error: 'invalid-document' };
    }

    const pb = this.client ?? this.createClient(config.serverUrl);
    this.client = pb;
    try {
      await pb.health.check({ requestKey: null });
    } catch {
      return { ok: false, error: 'not-available-offline' };
    }

    try {
      if (!pb.authStore.isValid) {
        await authenticateRelayAppUserShared(pb, config.serverUrl, config.secret);
      }
      const raw = await this.getRecord(pb, request.documentId);
      const record = asKnowledgeRecord(raw);
      if (record?.checksum !== request.checksum) {
        return { ok: false, error: 'invalid-document' };
      }
      return await this.downloadProtectedPdf(pb, raw, record, true);
    } catch {
      return { ok: false, error: 'download-failed' };
    }
  }

  private async getRecord(pb: PocketBase, documentId: string): Promise<unknown> {
    return pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getOne(documentId, { requestKey: null });
  }

  private async downloadProtectedPdf(
    pb: PocketBase,
    rawRecord: unknown,
    record: KnowledgeDocumentRecord,
    cache: boolean,
  ): Promise<KnowledgePdfResult> {
    if (!rawRecord || typeof rawRecord !== 'object')
      return { ok: false, error: 'invalid-document' };
    const token = await pb.files.getToken({ requestKey: null });
    const url = pb.files.getURL(rawRecord as Record<string, unknown>, record.pdf, { token });
    if (!url) return { ok: false, error: 'not-found' };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const data = await this.fetchBytes(url, Math.min(record.byteSize, KNOWLEDGE_MAX_PDF_BYTES));
      if (!data) return { ok: false, error: 'download-failed' };
      if (!validPdfBytes(data, record)) continue;
      if (cache) await this.promoteCache(record.checksum, data);
      return this.success(data, record.checksum, 'download');
    }
    return { ok: false, error: 'checksum-mismatch' };
  }

  private async fetchBytes(url: string, maxBytes: number): Promise<Uint8Array | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await this.fetchPdf(url, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private cachePath(checksum: string): string {
    return join(this.cacheDir, `${checksum}.pdf`);
  }

  private async readCache(checksum: string): Promise<Uint8Array | null> {
    const path = this.cachePath(checksum);
    try {
      const details = await stat(path);
      if (!details.isFile() || details.size <= 0 || details.size > KNOWLEDGE_MAX_PDF_BYTES) {
        await rm(path, { force: true });
        return null;
      }
      const data = await readFile(path);
      if (
        checksumOf(data) !== checksum ||
        data.subarray(0, 5).toString('ascii') !== PDF_SIGNATURE
      ) {
        await rm(path, { force: true });
        return null;
      }
      const current = new Date();
      await utimes(path, current, current);
      return data;
    } catch {
      return null;
    }
  }

  private async promoteCache(checksum: string, data: Uint8Array): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const destination = this.cachePath(checksum);
    const temporary = join(this.cacheDir, `${checksum}.${process.pid}.${this.now()}.tmp`);
    try {
      await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
      await rm(destination, { force: true });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async readCacheEntries(): Promise<CacheEntry[]> {
    const entries = await readdir(this.cacheDir, { withFileTypes: true });
    const cacheEntries: CacheEntry[] = [];
    for (const entry of entries) {
      const match = /^([0-9a-f]{64})\.pdf$/.exec(entry.name);
      const path = join(this.cacheDir, entry.name);
      if (!match || !entry.isFile()) {
        if (entry.name.endsWith('.tmp')) await rm(path, { force: true });
        continue;
      }
      const details = await stat(path);
      cacheEntries.push({
        path,
        checksum: match[1] as string,
        size: details.size,
        modifiedAt: details.mtimeMs,
      });
    }
    return cacheEntries;
  }
}
