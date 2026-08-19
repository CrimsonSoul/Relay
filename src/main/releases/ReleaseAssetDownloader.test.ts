import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayInstallableAsset } from './ReleaseUpdateService';
import { downloadReleaseAsset } from './ReleaseAssetDownloader';

const PAYLOAD = new TextEncoder().encode('verified relay archive');
const PAYLOAD_SHA256 = 'f352b905fa9308f06174a3b09ba4a0b4d159afc5e1345cb0d262e65e1587b75a';

function asset(overrides: Partial<RelayInstallableAsset> = {}): RelayInstallableAsset {
  return {
    id: 10,
    name: 'Relay-v1.1.0-windows-x64.zip',
    apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/10',
    size: PAYLOAD.byteLength,
    sha256: PAYLOAD_SHA256,
    ...overrides,
  };
}

function downloadResponse(
  body: ConstructorParameters<typeof Response>[0] = PAYLOAD,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status: 200,
    headers: { 'content-length': String(PAYLOAD.byteLength), ...headers },
  });
}

describe('downloadReleaseAsset', () => {
  let directory: string;
  let destination: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'relay-release-download-'));
    destination = join(directory, 'Relay.zip');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('streams the exact GitHub asset into an exclusive file and reports monotonic progress', async () => {
    const progress: Array<[number, number]> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(input).toBe(asset().apiUrl);
      expect(init).toMatchObject({
        redirect: 'manual',
        headers: {
          Accept: 'application/octet-stream',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return downloadResponse();
    });

    await expect(
      downloadReleaseAsset(asset(), destination, {
        fetch,
        onProgress: (downloaded, total) => progress.push([downloaded, total]),
      }),
    ).resolves.toEqual({ bytes: PAYLOAD.byteLength, sha256: PAYLOAD_SHA256 });

    await expect(readFile(destination)).resolves.toEqual(Buffer.from(PAYLOAD));
    await expect(stat(`${destination}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(progress).toEqual([[PAYLOAD.byteLength, PAYLOAD.byteLength]]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps an in-progress download in a .part file until atomic publication', async () => {
    const streamState: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const progressReached: { resolve?: () => void } = {};
    const progress = new Promise<void>((resolvePromise) => {
      progressReached.resolve = resolvePromise;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamState.controller = controller;
        controller.enqueue(PAYLOAD.slice(0, 4));
      },
    });
    const pending = downloadReleaseAsset(asset(), destination, {
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-length': String(PAYLOAD.byteLength) },
        }),
      onProgress: () => progressReached.resolve?.(),
    });

    await progress;
    try {
      await expect(readFile(`${destination}.part`)).resolves.toEqual(
        Buffer.from(PAYLOAD.slice(0, 4)),
      );
      await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      streamState.controller?.enqueue(PAYLOAD.slice(4));
      streamState.controller?.close();
      await pending.catch(() => undefined);
    }

    await expect(readFile(destination)).resolves.toEqual(Buffer.from(PAYLOAD));
    await expect(stat(`${destination}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('follows only a bounded manual redirect to GitHub release storage', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              'https://release-assets.githubusercontent.com/github-production-release-asset/1/relay.zip?token=opaque',
          },
        }),
      )
      .mockResolvedValueOnce(downloadResponse());

    await expect(downloadReleaseAsset(asset(), destination, { fetch })).resolves.toEqual({
      bytes: PAYLOAD.byteLength,
      sha256: PAYLOAD_SHA256,
    });

    expect(fetch.mock.calls.map(([input]) => input)).toEqual([
      asset().apiUrl,
      'https://release-assets.githubusercontent.com/github-production-release-asset/1/relay.zip?token=opaque',
    ]);
  });

  it.each([
    'https://release-assets.githubusercontent.com/relay.zip'.replace('https:', 'http:'),
    'https://user:secret@release-assets.githubusercontent.com/relay.zip',
    'https://release-assets.githubusercontent.com:444/relay.zip',
    'https://relay.example/relay.zip',
  ])('rejects unsafe redirect target %s', async (location) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 302, headers: { location } }),
    );

    await expect(downloadReleaseAsset(asset(), destination, { fetch })).rejects.toThrow(
      /redirect/i,
    );
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a redirect loop after three redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://github.com/CrimsonSoul/Relay/releases/download/v1.1.0/a' },
        }),
    );

    await expect(downloadReleaseAsset(asset(), destination, { fetch })).rejects.toThrow(
      /redirect/i,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['missing length', downloadResponse(PAYLOAD, { 'content-length': '' })],
    ['wrong length', downloadResponse(PAYLOAD, { 'content-length': '999' })],
    ['HTTP failure', new Response('unavailable', { status: 503 })],
    ['missing body', downloadResponse(null)],
  ])('rejects a response with %s', async (_label, response) => {
    await expect(
      downloadReleaseAsset(asset(), destination, { fetch: async () => response }),
    ).rejects.toThrow();
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(`${destination}.part`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects and removes a download that exceeds its declared size', async () => {
    const largerPayload = new TextEncoder().encode('verified relay archive plus untrusted bytes');
    const response = new Response(largerPayload, {
      status: 200,
      headers: { 'content-length': String(largerPayload.byteLength) },
    });

    await expect(
      downloadReleaseAsset(asset({ size: largerPayload.byteLength - 1 }), destination, {
        fetch: async () => response,
      }),
    ).rejects.toThrow(/size/i);
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects and removes a download whose digest differs from GitHub metadata', async () => {
    await expect(
      downloadReleaseAsset(asset({ sha256: '0'.repeat(64) }), destination, {
        fetch: async () => downloadResponse(),
      }),
    ).rejects.toThrow(/digest/i);
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels an in-progress stream and removes its partial file', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(PAYLOAD.slice(0, 4));
      },
    });
    const response = new Response(body, {
      status: 200,
      headers: { 'content-length': String(PAYLOAD.byteLength) },
    });

    await expect(
      downloadReleaseAsset(asset(), destination, {
        fetch: async () => response,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toThrow();
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites a pre-existing destination', async () => {
    await writeFile(destination, 'keep me', 'utf8');

    await expect(
      downloadReleaseAsset(asset(), destination, { fetch: async () => downloadResponse() }),
    ).rejects.toThrow();
    await expect(readFile(destination, 'utf8')).resolves.toBe('keep me');
  });
});
