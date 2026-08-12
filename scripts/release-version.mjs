import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const CONVENTIONAL_SUBJECT_PATTERN = /^([a-z][a-z0-9-]*)(?:\([^\r\n)]+\))?(!)?:\s+\S.*$/iu;
const BREAKING_FOOTER_PATTERN = /^BREAKING[ -]CHANGE:\s*\S/im;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const PATCH_TYPES = new Set(['fix', 'perf', 'revert']);
const RELEASE_IMPACT = { none: 0, patch: 1, minor: 2, major: 3 };
const RELEASE_ACTIONS = new Set(['create', 'skip', 'verify']);
const RELEASE_TYPES = new Set(['existing', 'initial', 'major', 'minor', 'none', 'patch']);

function assertSafeVersionPart(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function incrementVersion(version, releaseType) {
  if (releaseType === 'major') return { major: version.major + 1, minor: 0, patch: 0 };
  if (releaseType === 'minor') return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

export function parseVersionTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = VERSION_TAG_PATTERN.exec(tag);
  if (!match) return null;

  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
  return Object.values(version).every(assertSafeVersionPart) ? version : null;
}

export function selectLatestVersionTag(tags) {
  return (
    tags
      .map((tag) => {
        const version = parseVersionTag(tag.name);
        return version ? { ...tag, version } : null;
      })
      .filter(Boolean)
      .sort((left, right) => compareVersions(right.version, left.version))[0] ?? null
  );
}

export function classifyConventionalCommit({ subject, body = '' }) {
  const match = CONVENTIONAL_SUBJECT_PATTERN.exec(subject ?? '');
  const breaking = Boolean(match?.[2]) || BREAKING_FOOTER_PATTERN.test(body ?? '');
  if (breaking) return 'major';
  if (!match) return 'none';

  const type = match[1].toLowerCase();
  if (type === 'feat') return 'minor';
  return PATCH_TYPES.has(type) ? 'patch' : 'none';
}

function highestReleaseType(commits) {
  return commits.reduce((highest, entry) => {
    const candidate = classifyConventionalCommit(entry);
    return RELEASE_IMPACT[candidate] > RELEASE_IMPACT[highest] ? candidate : highest;
  }, 'none');
}

export function planRelease({ latestTag, commits, headSha }) {
  if (!SOURCE_SHA_PATTERN.test(headSha ?? '')) {
    throw new Error('Release source SHA must be a full lowercase Git commit ID');
  }

  if (latestTag?.sha === headSha) {
    const version = formatVersion(latestTag.version);
    return {
      action: 'verify',
      previousTag: null,
      releaseType: 'existing',
      sourceSha: headSha,
      tag: latestTag.name,
      version,
    };
  }

  const releaseType = highestReleaseType(commits);
  if (releaseType === 'none') {
    return {
      action: 'skip',
      previousTag: latestTag?.name ?? null,
      releaseType,
      sourceSha: headSha,
      tag: null,
      version: null,
    };
  }

  const initial = latestTag === null;
  const nextVersion = initial
    ? { major: 1, minor: 0, patch: 0 }
    : incrementVersion(latestTag.version, releaseType);
  const version = formatVersion(nextVersion);

  return {
    action: 'create',
    previousTag: latestTag?.name ?? null,
    releaseType: initial ? 'initial' : releaseType,
    sourceSha: headSha,
    tag: `v${version}`,
    version,
  };
}

function runGit(args, cwd) {
  // Git is a required developer/CI tool here, and every argument is fixed or validated.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

function readReachableVersionTags(cwd) {
  const names = runGit(['tag', '--merged', 'HEAD', '--list', 'v*'], cwd)
    .split('\n')
    .filter(Boolean);

  return names.map((name) => ({
    name,
    sha: runGit(['rev-list', '-n', '1', name], cwd),
  }));
}

function readCommits(cwd, latestTag) {
  const range = latestTag ? `${latestTag.name}..HEAD` : 'HEAD';
  const history = runGit(['log', '--format=%H%x1f%s%x1f%b%x1e', range, '--'], cwd);
  if (!history) return [];

  return history
    .split('\x1e')
    .map((record) => record.replace(/^\n/u, '').replace(/\n$/u, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, ...body] = record.split('\x1f');
      if (!SOURCE_SHA_PATTERN.test(sha ?? '') || subject === undefined) {
        throw new Error('Git returned malformed release history');
      }
      return { body: body.join('\x1f'), subject };
    });
}

export function calculateRepositoryRelease({ cwd = process.cwd() } = {}) {
  const headSha = runGit(['rev-parse', 'HEAD'], cwd);
  const latestTag = selectLatestVersionTag(readReachableVersionTags(cwd));
  const commits = latestTag?.sha === headSha ? [] : readCommits(cwd, latestTag);
  return planRelease({ commits, headSha, latestTag });
}

function assertOutputResult(result) {
  if (
    !RELEASE_ACTIONS.has(result.action) ||
    !RELEASE_TYPES.has(result.releaseType) ||
    !SOURCE_SHA_PATTERN.test(result.sourceSha) ||
    (result.previousTag !== null && parseVersionTag(result.previousTag) === null) ||
    (result.tag !== null && parseVersionTag(result.tag) === null) ||
    (result.version !== null && parseVersionTag(`v${result.version}`) === null)
  ) {
    throw new Error('Refusing to write malformed release outputs');
  }
}

export async function writeGitHubOutputs(result, outputPath) {
  assertOutputResult(result);
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('GITHUB_OUTPUT is required');
  }

  const output = [
    `action=${result.action}`,
    `previous_tag=${result.previousTag ?? ''}`,
    `release_type=${result.releaseType}`,
    `source_sha=${result.sourceSha}`,
    `tag=${result.tag ?? ''}`,
    `version=${result.version ?? ''}`,
    '',
  ].join('\n');
  await appendFile(outputPath, output, 'utf8');
}

async function main() {
  const result = calculateRepositoryRelease();
  if (process.env.GITHUB_OUTPUT) await writeGitHubOutputs(result, process.env.GITHUB_OUTPUT);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (executedPath && executedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
