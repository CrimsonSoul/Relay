const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function hasCanonicalAssets(release, expectedAsset, expectedChecksum) {
  if (!Array.isArray(release.assets) || release.assets.length !== 2) return false;
  const expectedNames = new Set([expectedAsset, expectedChecksum]);
  for (const asset of release.assets) {
    if (
      !asset ||
      typeof asset !== 'object' ||
      !expectedNames.delete(asset.name) ||
      asset.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      typeof asset.digest !== 'string' ||
      !SHA256_DIGEST_PATTERN.test(asset.digest)
    ) {
      return false;
    }
  }
  return expectedNames.size === 0;
}

export function classifyExistingRelease(release, { expectedAsset, expectedChecksum, sourceSha }) {
  if (!release) return 'package';
  const complete =
    release.draft === false &&
    release.prerelease === false &&
    release.target_commitish === sourceSha &&
    hasCanonicalAssets(release, expectedAsset, expectedChecksum);

  if (complete) return 'complete';
  if (release.draft === true) return 'replace-draft';
  throw new Error('Refusing to modify incomplete published release');
}
export function resolveReleaseTestMode(configuredTree, sourceTree) {
  if (!/^[0-9a-f]{40}$/u.test(sourceTree)) throw new Error('Invalid release source tree');
  if (configuredTree === '') return false;
  if (!/^[0-9a-f]{40}$/u.test(configuredTree)) throw new Error('Invalid release test tree');
  return configuredTree === sourceTree;
}

export async function deleteTestDraft({ github, owner, repo, tag, sourceSha }) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });
  const matches = releases.filter((release) => release.tag_name === tag);
  if (matches.length === 0) return;
  if (matches.length !== 1) throw new Error('Ambiguous test draft release');
  const release = matches[0];
  if (release.draft !== true || release.target_commitish !== sourceSha) {
    throw new Error('Refusing to delete a published or unrelated release');
  }
  await github.rest.repos.deleteRelease({ owner, repo, release_id: release.id });
  try {
    await github.rest.repos.getRelease({ owner, repo, release_id: release.id });
  } catch (error) {
    if (error.status === 404) return;
    throw error;
  }
  throw new Error('Test draft release still exists after deletion');
}
