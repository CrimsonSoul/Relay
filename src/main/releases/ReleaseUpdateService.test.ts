import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  relayReleaseByTagApiUrl,
  RELAY_LATEST_RELEASE_API_URL,
  RELAY_RELEASE_HISTORY_API_URL,
} from '@shared/releases';
import { ReleaseUpdateService } from './ReleaseUpdateService';

const COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const ARCHIVE_DIGEST = 'a'.repeat(64);
const CHECKSUM_DIGEST = 'b'.repeat(64);

function githubAsset(
  id: number,
  name: string,
  size: number,
  digest: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    url: `https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/${id}`,
    id,
    node_id: `RA_${id}`,
    name,
    label: null,
    uploader: {
      login: 'github-actions[bot]',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      gravatar_id: '',
      url: 'https://api.github.com/users/github-actions%5Bbot%5D',
      html_url: 'https://github.com/apps/github-actions',
      followers_url: 'https://api.github.com/users/github-actions%5Bbot%5D/followers',
      following_url: 'https://api.github.com/users/github-actions%5Bbot%5D/following{/other_user}',
      gists_url: 'https://api.github.com/users/github-actions%5Bbot%5D/gists{/gist_id}',
      starred_url: 'https://api.github.com/users/github-actions%5Bbot%5D/starred{/owner}{/repo}',
      subscriptions_url: 'https://api.github.com/users/github-actions%5Bbot%5D/subscriptions',
      organizations_url: 'https://api.github.com/users/github-actions%5Bbot%5D/orgs',
      repos_url: 'https://api.github.com/users/github-actions%5Bbot%5D/repos',
      events_url: 'https://api.github.com/users/github-actions%5Bbot%5D/events{/privacy}',
      received_events_url: 'https://api.github.com/users/github-actions%5Bbot%5D/received_events',
      type: 'Bot',
      user_view_type: 'public',
      site_admin: false,
    },
    content_type: name.endsWith('.sha256') ? 'text/plain' : 'application/zip',
    state: 'uploaded',
    size,
    digest: `sha256:${digest}`,
    download_count: 0,
    created_at: '2026-08-12T12:43:00Z',
    updated_at: '2026-08-12T12:43:00Z',
    browser_download_url: `https://github.com/CrimsonSoul/Relay/releases/download/v1.1.0/${name}`,
    ...overrides,
  };
}

function installableAssets(version = '1.1.0') {
  const archive = `Relay-v${version}-windows-x64.zip`;
  return [
    githubAsset(10, archive, 140_000_000, ARCHIVE_DIGEST, {
      browser_download_url: `https://github.com/CrimsonSoul/Relay/releases/download/v${version}/${archive}`,
    }),
    githubAsset(11, `${archive}.sha256`, 95, CHECKSUM_DIGEST, {
      browser_download_url: `https://github.com/CrimsonSoul/Relay/releases/download/v${version}/${archive}.sha256`,
    }),
  ];
}

function githubRelease(tagName: string, overrides: Record<string, unknown> = {}) {
  return {
    url: `https://api.github.com/repos/CrimsonSoul/Relay/releases/1`,
    assets_url: `https://api.github.com/repos/CrimsonSoul/Relay/releases/1/assets`,
    upload_url: `https://uploads.github.com/repos/CrimsonSoul/Relay/releases/1/assets{?name,label}`,
    html_url: `https://github.com/CrimsonSoul/Relay/releases/tag/${tagName}`,
    id: 1,
    author: {
      login: 'github-actions[bot]',
      id: 2,
      node_id: 'MDQ6VXNlcjI=',
      avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
      gravatar_id: '',
      url: 'https://api.github.com/users/github-actions%5Bbot%5D',
      html_url: 'https://github.com/apps/github-actions',
      followers_url: 'https://api.github.com/users/github-actions%5Bbot%5D/followers',
      following_url: 'https://api.github.com/users/github-actions%5Bbot%5D/following{/other_user}',
      gists_url: 'https://api.github.com/users/github-actions%5Bbot%5D/gists{/gist_id}',
      starred_url: 'https://api.github.com/users/github-actions%5Bbot%5D/starred{/owner}{/repo}',
      subscriptions_url: 'https://api.github.com/users/github-actions%5Bbot%5D/subscriptions',
      organizations_url: 'https://api.github.com/users/github-actions%5Bbot%5D/orgs',
      repos_url: 'https://api.github.com/users/github-actions%5Bbot%5D/repos',
      events_url: 'https://api.github.com/users/github-actions%5Bbot%5D/events{/privacy}',
      received_events_url: 'https://api.github.com/users/github-actions%5Bbot%5D/received_events',
      type: 'Bot',
      user_view_type: 'public',
      site_admin: false,
    },
    node_id: 'RE_kwDOExample',
    tag_name: tagName,
    target_commitish: COMMIT_SHA,
    name: `Relay ${tagName}`,
    draft: false,
    immutable: true,
    prerelease: false,
    created_at: '2026-08-12T12:40:00Z',
    updated_at: '2026-08-12T12:44:01Z',
    published_at: '2026-08-12T12:44:01Z',
    assets: installableAssets(tagName.startsWith('v') ? tagName.slice(1) : '1.1.0'),
    tarball_url: `https://api.github.com/repos/CrimsonSoul/Relay/tarball/${tagName}`,
    zipball_url: `https://api.github.com/repos/CrimsonSoul/Relay/zipball/${tagName}`,
    body: 'Generated release notes.',
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ConstructorParameters<typeof Response>[1] = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

describe('ReleaseUpdateService', () => {
  it('reports a newer normal GitHub release against the packaged version', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(input).toBe(RELAY_LATEST_RELEASE_API_URL);
      expect(init).toMatchObject({
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Relay/1.0.0',
        },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse(githubRelease('v1.1.0'));
    });
    const service = new ReleaseUpdateService({
      fetch,
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).resolves.toEqual({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      targetCommitish: COMMIT_SHA,
      updateAvailable: true,
      installable: true,
      assetSizeBytes: 140_000_000,
      releaseNotes: {
        version: '1.1.0',
        title: 'Relay v1.1.0',
        body: 'Generated release notes.',
        publishedAt: '2026-08-12T12:44:01Z',
        immutable: true,
      },
    });
  });

  it('keeps the persisted release-note cache within its own read bound', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-release-notes-'));
    const cacheFilePath = join(directory, 'release-notes.json');
    try {
      for (let patch = 1; patch <= 10; patch += 1) {
        const version = `1.0.${patch}`;
        const service = new ReleaseUpdateService({
          fetch: async () =>
            jsonResponse(githubRelease(`v${version}`, { body: 'x'.repeat(52 * 1_024) })),
          getCurrentVersion: () => '0.0.0',
          cacheFilePath,
        });
        await service.check();
      }

      expect((await stat(cacheFilePath)).size).toBeLessThanOrEqual(512 * 1_024);
      const offlineService = new ReleaseUpdateService({
        fetch: async () => {
          throw new Error('offline');
        },
        getCurrentVersion: () => '0.0.0',
        cacheFilePath,
      });
      const cached = await offlineService.getCachedReleaseNotes();
      expect(cached.length).toBeGreaterThan(0);
      expect(cached.length).toBeLessThan(10);
      expect(cached[0]?.version).toBe('1.0.10');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists stable release notes and serves them from a new service instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-release-notes-'));
    const cacheFilePath = join(directory, 'release-notes.json');
    try {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        expect(input).toBe(RELAY_RELEASE_HISTORY_API_URL);
        return jsonResponse([githubRelease('v1.2.0'), githubRelease('v1.1.0')]);
      });
      const service = new ReleaseUpdateService({
        fetch,
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });

      await expect(service.refreshReleaseNotes()).resolves.toEqual([
        {
          version: '1.2.0',
          title: 'Relay v1.2.0',
          body: 'Generated release notes.',
          publishedAt: '2026-08-12T12:44:01Z',
          immutable: true,
        },
        {
          version: '1.1.0',
          title: 'Relay v1.1.0',
          body: 'Generated release notes.',
          publishedAt: '2026-08-12T12:44:01Z',
          immutable: true,
        },
      ]);

      const offlineService = new ReleaseUpdateService({
        fetch: async () => {
          throw new Error('offline');
        },
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });
      await expect(offlineService.getCachedReleaseNotes()).resolves.toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('adds a discovered latest release to cached history without replacing immutable notes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-release-notes-'));
    const cacheFilePath = join(directory, 'release-notes.json');
    try {
      const seed = new ReleaseUpdateService({
        fetch: async () =>
          jsonResponse([
            githubRelease('v1.1.0', { body: 'Original immutable notes.' }),
            githubRelease('v1.0.0'),
          ]),
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });
      await seed.refreshReleaseNotes();

      const updater = new ReleaseUpdateService({
        fetch: async () => jsonResponse(githubRelease('v1.2.0')),
        getCurrentVersion: () => '1.1.0',
        cacheFilePath,
      });
      await updater.check();

      await expect(updater.getCachedReleaseNotes()).resolves.toMatchObject([
        { version: '1.2.0', body: 'Generated release notes.' },
        { version: '1.1.0', body: 'Original immutable notes.' },
        { version: '1.0.0' },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not replace cached immutable notes during a history refresh', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-release-notes-'));
    const cacheFilePath = join(directory, 'release-notes.json');
    try {
      const seed = new ReleaseUpdateService({
        fetch: async () =>
          jsonResponse([githubRelease('v1.1.0', { body: 'Original immutable notes.' })]),
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });
      await seed.refreshReleaseNotes();

      const refresh = new ReleaseUpdateService({
        fetch: async () =>
          jsonResponse([
            githubRelease('v1.2.0'),
            githubRelease('v1.1.0', { body: 'Changed notes.', immutable: false }),
          ]),
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });

      await expect(refresh.refreshReleaseNotes()).resolves.toMatchObject([
        { version: '1.2.0' },
        { version: '1.1.0', body: 'Original immutable notes.', immutable: true },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses a persisted ETag to avoid downloading unchanged release notes again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-release-notes-'));
    const cacheFilePath = join(directory, 'release-notes.json');
    try {
      const seed = new ReleaseUpdateService({
        fetch: async () =>
          jsonResponse([githubRelease('v1.1.0')], {
            headers: {
              'content-type': 'application/json; charset=utf-8',
              etag: '"release-history-1"',
            },
          }),
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });
      await seed.refreshReleaseNotes();

      const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        expect(init?.headers).toMatchObject({ 'If-None-Match': '"release-history-1"' });
        return new Response(null, { status: 304 });
      });
      const next = new ReleaseUpdateService({
        fetch,
        getCurrentVersion: () => '1.0.0',
        cacheFilePath,
      });

      await expect(next.refreshReleaseNotes()).resolves.toMatchObject([{ version: '1.1.0' }]);
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drops oversized release-note fields before they reach the cache or renderer', async () => {
    const service = new ReleaseUpdateService({
      fetch: async () =>
        jsonResponse([
          githubRelease('v1.2.0', { body: 'x'.repeat(70_000) }),
          githubRelease('v1.1.0'),
        ]),
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.refreshReleaseNotes()).resolves.toMatchObject([{ version: '1.1.0' }]);
  });

  it('keeps update discovery available when a release has no readable notes', async () => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(githubRelease('v1.1.0', { body: null })),
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).resolves.toMatchObject({
      latestVersion: '1.1.0',
      updateAvailable: true,
      installable: true,
      releaseNotes: null,
    });
  });

  it.each([
    ['same release', '1.2.3'],
    ['older release', '1.2.2'],
  ])('does not offer an update for the %s', async (_label, latestVersion) => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(githubRelease(`v${latestVersion}`)),
      getCurrentVersion: () => '1.2.3',
    });

    await expect(service.check()).resolves.toEqual({
      currentVersion: '1.2.3',
      latestVersion,
      targetCommitish: null,
      updateAvailable: false,
      installable: false,
      assetSizeBytes: null,
      releaseNotes: {
        version: latestVersion,
        title: `Relay v${latestVersion}`,
        body: 'Generated release notes.',
        publishedAt: '2026-08-12T12:44:01Z',
        immutable: true,
      },
    });
  });

  it('keeps a newer mutable release advisory-only', async () => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(githubRelease('v1.1.0', { immutable: false })),
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).resolves.toEqual({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      targetCommitish: null,
      updateAvailable: true,
      installable: false,
      assetSizeBytes: null,
      releaseNotes: {
        version: '1.1.0',
        title: 'Relay v1.1.0',
        body: 'Generated release notes.',
        publishedAt: '2026-08-12T12:44:01Z',
        immutable: false,
      },
    });
  });

  it.each([
    ['missing assets', []],
    ['duplicate archive', [...installableAssets(), installableAssets()[0]]],
    [
      'unuploaded archive',
      [
        githubAsset(10, 'Relay-v1.1.0-windows-x64.zip', 140_000_000, ARCHIVE_DIGEST, {
          state: 'new',
        }),
        installableAssets()[1],
      ],
    ],
    [
      'malformed archive digest',
      [
        githubAsset(10, 'Relay-v1.1.0-windows-x64.zip', 140_000_000, ARCHIVE_DIGEST, {
          digest: 'sha256:not-a-digest',
        }),
        installableAssets()[1],
      ],
    ],
    [
      'wrong asset API URL',
      [
        githubAsset(10, 'Relay-v1.1.0-windows-x64.zip', 140_000_000, ARCHIVE_DIGEST, {
          url: 'https://api.github.com/repos/SomeoneElse/Relay/releases/assets/10',
        }),
        installableAssets()[1],
      ],
    ],
    [
      'oversized archive',
      [
        githubAsset(10, 'Relay-v1.1.0-windows-x64.zip', 600_000_000, ARCHIVE_DIGEST),
        installableAssets()[1],
      ],
    ],
  ])('keeps a release with %s advisory-only', async (_label, assets) => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(githubRelease('v1.1.0', { assets })),
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).resolves.toMatchObject({
      latestVersion: '1.1.0',
      updateAvailable: true,
      installable: false,
      assetSizeBytes: null,
    });
  });

  it('keeps a release that does not target an exact commit advisory-only', async () => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(githubRelease('v1.1.0', { target_commitish: 'test' })),
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).resolves.toMatchObject({
      latestVersion: '1.1.0',
      updateAvailable: true,
      installable: false,
      assetSizeBytes: null,
    });
  });

  it('refetches and resolves only an immutable newer release for installation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(githubRelease('v1.1.0')));
    const service = new ReleaseUpdateService({ fetch, getCurrentVersion: () => '1.0.0' });

    await service.check();
    await expect(service.resolveLatestInstallable()).resolves.toMatchObject({
      version: '1.1.0',
      targetCommitish: COMMIT_SHA,
      archive: {
        id: 10,
        name: 'Relay-v1.1.0-windows-x64.zip',
        size: 140_000_000,
        sha256: ARCHIVE_DIGEST,
      },
      checksum: {
        id: 11,
        name: 'Relay-v1.1.0-windows-x64.zip.sha256',
        size: 95,
        sha256: CHECKSUM_DIGEST,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves an immutable historical release only through its exact canonical tag', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(input).toBe(relayReleaseByTagApiUrl('1.1.0'));
      return jsonResponse(githubRelease('v1.1.0'));
    });
    const service = new ReleaseUpdateService({ fetch, getCurrentVersion: () => '1.2.0' });

    await expect(service.resolveInstallableByTag('1.1.0', COMMIT_SHA)).resolves.toMatchObject({
      version: '1.1.0',
      targetCommitish: COMMIT_SHA,
    });
  });

  it.each([
    ['a mutable release', githubRelease('v1.1.0', { immutable: false })],
    ['a substituted tag', githubRelease('v1.2.0')],
    ['a substituted commit', githubRelease('v1.1.0', { target_commitish: 'f'.repeat(40) })],
  ])('refuses exact-tag recovery from %s', async (_label, response) => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(response),
      getCurrentVersion: () => '1.2.0',
    });

    await expect(service.resolveInstallableByTag('1.1.0', COMMIT_SHA)).rejects.toThrow();
  });

  it('refuses installation when the refreshed latest release becomes mutable', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease('v1.1.0')))
      .mockResolvedValueOnce(jsonResponse(githubRelease('v1.1.0', { immutable: false })));
    const service = new ReleaseUpdateService({ fetch, getCurrentVersion: () => '1.0.0' });

    await service.check();
    await expect(service.resolveLatestInstallable()).rejects.toThrow(/immutable/i);
  });

  it('refuses installation when the latest release changed after discovery', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(githubRelease('v1.1.0')))
      .mockResolvedValueOnce(jsonResponse(githubRelease('v1.2.0')));
    const service = new ReleaseUpdateService({ fetch, getCurrentVersion: () => '1.0.0' });

    await service.check();
    await expect(service.resolveLatestInstallable()).rejects.toThrow(/changed/i);
  });

  it.each([
    ['a prerelease', jsonResponse(githubRelease('v1.1.0', { prerelease: true }))],
    ['a draft', jsonResponse(githubRelease('v1.1.0', { draft: true }))],
    ['a malformed tag', jsonResponse(githubRelease('release-1.1.0'))],
    [
      'a non-JSON response',
      new Response('<html>not a release</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ],
    [
      'an unsuccessful response',
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'an oversized response',
      new Response('x'.repeat(65_537), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('rejects %s from the release endpoint', async (_label, response) => {
    const service = new ReleaseUpdateService({
      fetch: async () => response,
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).rejects.toThrow();
  });

  it('cancels a chunked release response as soon as it exceeds 64 KiB', async () => {
    let enqueuedChunks = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 3; index += 1) {
          controller.enqueue(new Uint8Array(32 * 1_024));
          enqueuedChunks += 1;
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    const service = new ReleaseUpdateService({
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      getCurrentVersion: () => '1.0.0',
    });

    await expect(service.check()).rejects.toThrow(/size limit/i);
    expect(cancelled).toBe(true);
    expect(enqueuedChunks).toBe(3);
  });

  it('rejects a non-release package version instead of guessing', async () => {
    const service = new ReleaseUpdateService({
      fetch: async () => jsonResponse(githubRelease('v1.1.0')),
      getCurrentVersion: () => '1.0.0-beta.1',
    });

    await expect(service.check()).rejects.toThrow();
  });

  it('fetches a fresh release after a completed check', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse(githubRelease('v1.1.0')));
    const service = new ReleaseUpdateService({
      fetch,
      getCurrentVersion: () => '1.0.0',
    });

    await service.check();
    await service.check();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent checks into one GitHub request', async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const service = new ReleaseUpdateService({
      fetch,
      getCurrentVersion: () => '1.0.0',
    });

    const first = service.check();
    const second = service.check();
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveResponse(jsonResponse(githubRelease('v1.1.0')));
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        targetCommitish: COMMIT_SHA,
        updateAvailable: true,
        installable: true,
        assetSizeBytes: 140_000_000,
        releaseNotes: {
          version: '1.1.0',
          title: 'Relay v1.1.0',
          body: 'Generated release notes.',
          publishedAt: '2026-08-12T12:44:01Z',
          immutable: true,
        },
      },
      {
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        targetCommitish: COMMIT_SHA,
        updateAvailable: true,
        installable: true,
        assetSizeBytes: 140_000_000,
        releaseNotes: {
          version: '1.1.0',
          title: 'Relay v1.1.0',
          body: 'Generated release notes.',
          publishedAt: '2026-08-12T12:44:01Z',
          immutable: true,
        },
      },
    ]);
  });
});
