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
