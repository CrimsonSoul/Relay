import { createHash } from 'node:crypto';
import { lstat, open, rename, rm, type FileHandle } from 'node:fs/promises';
import type { RelayInstallableAsset } from './ReleaseUpdateService';

type FetchRequestInit = NonNullable<Parameters<typeof fetch>[1]>;
type NoStoreFetchRequestInit = FetchRequestInit & { cache: 'no-store' };

export type ReleaseAssetDownloadOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  requestTimeoutMs?: number;
};

export type ReleaseAssetDownloadResult = {
  bytes: number;
  sha256: string;
};

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_REDIRECTS = 3;
const MAX_ASSET_BYTES = 512 * 1_024 * 1_024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const ASSET_API_PATTERN =
  /^https:\/\/api\.github\.com\/repos\/CrimsonSoul\/Relay\/releases\/assets\/([1-9]\d*)$/u;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function validateAsset(asset: RelayInstallableAsset): void {
  const match = ASSET_API_PATTERN.exec(asset.apiUrl);
  if (!match || Number(match[1]) !== asset.id) {
    throw new Error('Release asset URL did not match the fixed GitHub repository');
  }
  if (
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > MAX_ASSET_BYTES ||
    !SHA256_PATTERN.test(asset.sha256)
  ) {
    throw new Error('Release asset metadata was invalid');
  }
}

function validateRedirect(currentUrl: string, location: string | null): string {
  if (!location) throw new Error('GitHub release redirect was missing its location');

  let target: URL;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new Error('GitHub release redirect was invalid');
  }

  if (
    target.protocol !== 'https:' ||
    target.username !== '' ||
    target.password !== '' ||
    target.port !== '' ||
    !ALLOWED_DOWNLOAD_HOSTS.has(target.hostname)
  ) {
    throw new Error('GitHub release redirect was outside the allowed download hosts');
  }
  return target.href;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Release download cancelled');
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('Release download failed'));
      },
    );
  });
}

async function fetchAssetResponse(
  asset: RelayInstallableAsset,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<Response> {
  let url = asset.apiUrl;
  let redirects = 0;

  while (true) {
    const request: NoStoreFetchRequestInit = {
      cache: 'no-store',
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'application/octet-stream',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Relay-Updater',
      },
    };
    const response = await raceAbort(fetchImpl(url, request), signal);

    if (response.status === 302) {
      if (redirects >= MAX_REDIRECTS) {
        throw new Error('GitHub release download exceeded the redirect limit');
      }
      url = validateRedirect(url, response.headers.get('location'));
      redirects += 1;
      continue;
    }
    if (response.status !== 200) {
      throw new Error(`GitHub release download returned HTTP ${response.status}`);
    }
    return response;
  }
}

async function writeChunk(file: FileHandle, value: Uint8Array): Promise<void> {
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await file.write(buffer, offset, buffer.byteLength - offset);
    if (result.bytesWritten <= 0) throw new Error('Release download could not write its output');
    offset += result.bytesWritten;
  }
}

function responseReader(
  response: Response,
  asset: RelayInstallableAsset,
): ReadableStreamDefaultReader<Uint8Array> {
  const contentLength = response.headers.get('content-length') ?? '';
  if (!POSITIVE_INTEGER_PATTERN.test(contentLength) || Number(contentLength) !== asset.size) {
    throw new Error('GitHub release download size did not match its metadata');
  }
  if (!response.body) throw new Error('GitHub release download did not contain a body');
  return response.body.getReader();
}

async function writeResponseBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  file: FileHandle,
  asset: RelayInstallableAsset,
  signal: AbortSignal,
  onProgress?: (downloadedBytes: number, totalBytes: number) => void,
): Promise<ReleaseAssetDownloadResult> {
  const hash = createHash('sha256');
  let bytes = 0;

  while (true) {
    const result = await raceAbort(reader.read(), signal);
    if (result.done) break;
    if (!result.value || result.value.byteLength === 0) continue;
    bytes += result.value.byteLength;
    if (bytes > asset.size) throw new Error('GitHub release download exceeded its size limit');
    hash.update(result.value);
    await raceAbort(writeChunk(file, result.value), signal);
    onProgress?.(bytes, asset.size);
  }

  if (bytes !== asset.size) throw new Error('GitHub release download ended before its full size');
  const sha256 = hash.digest('hex');
  if (sha256 !== asset.sha256) {
    throw new Error('GitHub release download digest did not match its metadata');
  }
  return { bytes, sha256 };
}

async function assertDestinationMissing(destination: string): Promise<void> {
  try {
    await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Release download destination already exists');
}

export async function downloadReleaseAsset(
  asset: RelayInstallableAsset,
  destination: string,
  options: ReleaseAssetDownloadOptions = {},
): Promise<ReleaseAssetDownloadResult> {
  validateAsset(asset);
  await assertDestinationMissing(destination);
  const partialDestination = `${destination}.part`;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) relayAbort();
  else options.signal?.addEventListener('abort', relayAbort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new Error('Release download timed out')),
    options.requestTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
  );

  let file: FileHandle | null = null;
  let createdPartialDestination = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await fetchAssetResponse(asset, fetchImpl, controller.signal);
    reader = responseReader(response, asset);
    file = await open(partialDestination, 'wx', 0o600);
    createdPartialDestination = true;
    const result = await writeResponseBody(
      reader,
      file,
      asset,
      controller.signal,
      options.onProgress,
    );
    await file.sync();
    await file.close();
    file = null;
    await assertDestinationMissing(destination);
    await rename(partialDestination, destination);
    createdPartialDestination = false;
    return result;
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    await file?.close().catch(() => undefined);
    if (createdPartialDestination) {
      await rm(partialDestination, { force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', relayAbort);
  }
}
