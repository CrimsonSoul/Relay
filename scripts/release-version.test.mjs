import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyConventionalCommit,
  parseVersionTag,
  planRelease,
  selectLatestVersionTag,
} from './release-version.mjs';

const sourceSha = '1234567890abcdef1234567890abcdef12345678';
const commit = (subject, body = '') => ({ body, subject });
const releaseScript = path.resolve(import.meta.dirname, 'release-version.mjs');

function git(cwd, ...args) {
  // Git is the fixture engine for this isolated temporary repository.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('Relay release versioning', () => {
  it.each([
    ['fix: repair startup', '', 'patch'],
    ['perf(renderer): reduce layout work', '', 'patch'],
    ['revert: restore stable bootstrap', '', 'patch'],
    ['feat: add automatic releases', '', 'minor'],
    ['feat!: replace the data contract', '', 'major'],
    ['chore(api)!: remove the legacy endpoint', '', 'major'],
    ['fix: change the API', 'BREAKING CHANGE: clients must migrate', 'major'],
    ['fix: keep the API', 'BREAKINGCHANGE: this is not a conventional footer', 'patch'],
    ['docs: explain releases', '', 'none'],
    ['test: cover releases', '', 'none'],
    ['ci: package Relay', '', 'none'],
    ['Merge pull request #1 from CrimsonSoul/example', '', 'none'],
  ])('classifies %s as %s', (subject, body, expected) => {
    expect(classifyConventionalCommit(commit(subject, body))).toBe(expected);
  });

  it('accepts only canonical normal v-prefixed semantic versions', () => {
    expect(parseVersionTag('v12.3.45')).toEqual({ major: 12, minor: 3, patch: 45 });

    for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-beta.1']) {
      expect(parseVersionTag(tag)).toBeNull();
    }
  });

  it('selects the highest reachable valid semantic version independent of tag order', () => {
    expect(
      selectLatestVersionTag([
        { name: 'v1.9.9', sha: 'a'.repeat(40) },
        { name: 'not-a-version', sha: 'b'.repeat(40) },
        { name: 'v2.0.0', sha: 'c'.repeat(40) },
        { name: 'v1.10.0', sha: 'd'.repeat(40) },
      ]),
    ).toEqual({
      name: 'v2.0.0',
      sha: 'c'.repeat(40),
      version: { major: 2, minor: 0, patch: 0 },
    });
  });

  it('creates the first release as v1.0.0', () => {
    expect(
      planRelease({
        commits: [commit('feat: establish Relay releases')],
        headSha: sourceSha,
        latestTag: null,
      }),
    ).toEqual({
      action: 'create',
      previousTag: null,
      releaseType: 'initial',
      sourceSha,
      tag: 'v1.0.0',
      version: '1.0.0',
    });
  });

  it('uses the highest release impact across all commits since the latest tag', () => {
    expect(
      planRelease({
        commits: [
          commit('fix: correct checksum output'),
          commit('feat: add release downloads'),
          commit('docs: explain the workflow'),
        ],
        headSha: sourceSha,
        latestTag: {
          name: 'v1.2.3',
          sha: 'a'.repeat(40),
          version: { major: 1, minor: 2, patch: 3 },
        },
      }),
    ).toEqual({
      action: 'create',
      previousTag: 'v1.2.3',
      releaseType: 'minor',
      sourceSha,
      tag: 'v1.3.0',
      version: '1.3.0',
    });
  });

  it('recognizes conventional commit subjects preserved by a GitHub squash merge', () => {
    expect(
      planRelease({
        commits: [
          commit(
            'Add secure manual updates and Dynatrace filtering (#238)',
            [
              '* feat: add secure updates and Dynatrace filtering',
              '',
              '* fix: resolve updater quality findings',
              '',
              '---------',
              '',
              'Co-authored-by: Relay Test <relay-test@example.invalid>',
            ].join('\n'),
          ),
        ],
        headSha: sourceSha,
        latestTag: {
          name: 'v1.4.0',
          sha: 'a'.repeat(40),
          version: { major: 1, minor: 4, patch: 0 },
        },
      }),
    ).toMatchObject({ releaseType: 'minor', tag: 'v1.5.0', version: '1.5.0' });
  });

  it('increments major versions for breaking changes', () => {
    expect(
      planRelease({
        commits: [commit('fix: replace protocol', 'BREAKING-CHANGE: old clients are unsupported')],
        headSha: sourceSha,
        latestTag: {
          name: 'v1.8.4',
          sha: 'a'.repeat(40),
          version: { major: 1, minor: 8, patch: 4 },
        },
      }),
    ).toMatchObject({ releaseType: 'major', tag: 'v2.0.0', version: '2.0.0' });
  });

  it('skips changes that do not affect the distributed application', () => {
    expect(
      planRelease({
        commits: [commit('docs: update contributor notes'), commit('test: cover the workflow')],
        headSha: sourceSha,
        latestTag: {
          name: 'v1.2.3',
          sha: 'a'.repeat(40),
          version: { major: 1, minor: 2, patch: 3 },
        },
      }),
    ).toEqual({
      action: 'skip',
      previousTag: 'v1.2.3',
      releaseType: 'none',
      sourceSha,
      tag: null,
      version: null,
    });
  });

  it('verifies instead of duplicating a tag already attached to the source commit', () => {
    expect(
      planRelease({
        commits: [],
        headSha: sourceSha,
        latestTag: {
          name: 'v1.2.3',
          sha: sourceSha,
          version: { major: 1, minor: 2, patch: 3 },
        },
      }),
    ).toEqual({
      action: 'verify',
      previousTag: null,
      releaseType: 'existing',
      sourceSha,
      tag: 'v1.2.3',
      version: '1.2.3',
    });
  });

  it('derives a release from real Git history and writes bounded GitHub Actions outputs', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'relay-release-version-'));
    const outputPath = path.join(repository, 'github-output.txt');

    try {
      git(repository, 'init', '--initial-branch=test');
      git(repository, 'config', 'user.name', 'Relay Test');
      git(repository, 'config', 'user.email', 'relay-test@example.invalid');
      git(repository, 'commit', '--allow-empty', '-m', 'feat: create release automation');
      const headSha = git(repository, 'rev-parse', 'HEAD');

      const result = spawnSync(process.execPath, [releaseScript], {
        cwd: repository,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputPath },
      });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        action: 'create',
        previousTag: null,
        releaseType: 'initial',
        sourceSha: headSha,
        tag: 'v1.0.0',
        version: '1.0.0',
      });
      expect(await readFile(outputPath, 'utf8')).toBe(
        [
          'action=create',
          'previous_tag=',
          'release_type=initial',
          `source_sha=${headSha}`,
          'tag=v1.0.0',
          'version=1.0.0',
          '',
        ].join('\n'),
      );
    } finally {
      await rm(repository, { force: true, recursive: true });
    }
  });

  it('derives the first release when untagged Git history exceeds the default child-process buffer', async () => {
    const repository = await mkdtemp(path.join(tmpdir(), 'relay-release-version-large-history-'));
    const messagePath = path.join(repository, 'commit-message.txt');

    try {
      git(repository, 'init', '--initial-branch=test');
      git(repository, 'config', 'user.name', 'Relay Test');
      git(repository, 'config', 'user.email', 'relay-test@example.invalid');
      await writeFile(
        messagePath,
        `feat: create release automation\n\n${'release context '.repeat(80_000)}`,
        'utf8',
      );
      git(repository, 'commit', '--allow-empty', '-F', messagePath);

      const result = spawnSync(process.execPath, [releaseScript], {
        cwd: repository,
        encoding: 'utf8',
      });

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        action: 'create',
        releaseType: 'initial',
        tag: 'v1.0.0',
      });
    } finally {
      await rm(repository, { force: true, recursive: true });
    }
  });
});
