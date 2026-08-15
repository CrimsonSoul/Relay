import { describe, expect, it, vi } from 'vitest';
import { RELAY_LATEST_RELEASE_API_URL } from '@shared/releases';
import { ReleaseUpdateService } from './ReleaseUpdateService';

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
    target_commitish: 'test',
    name: `Relay ${tagName}`,
    draft: false,
    immutable: false,
    prerelease: false,
    created_at: '2026-08-12T12:40:00Z',
    updated_at: '2026-08-12T12:44:01Z',
    published_at: '2026-08-12T12:44:01Z',
    assets: [],
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
      updateAvailable: true,
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
      updateAvailable: false,
    });
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
      { currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true },
      { currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true },
    ]);
  });
});
