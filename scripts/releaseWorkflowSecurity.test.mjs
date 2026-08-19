import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { classifyExistingRelease } from './releaseWorkflowContract.mjs';

const execFileAsync = promisify(execFile);
const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);
const windowsWorkflowUrl = new URL(
  '../.github/workflows/reusable-windows-package.yml',
  import.meta.url,
);
const readWorkflowText = () => readFile(workflowUrl, 'utf8');
const readWorkflow = async () => parse(await readWorkflowText());
const findStep = (job, name) => job.steps.find((step) => step.name === name);

describe('release workflow authority boundary', () => {
  it('selects the reviewed immutable release action revision', async () => {
    const workflow = await readWorkflowText();
    const prefix = 'uses: softprops/action-gh-release@';
    const releaseActionLine = workflow
      .split(/\r?\n/u)
      .map((line) => line.trimStart())
      .find((line) => line.startsWith(prefix));
    const releaseAction = releaseActionLine?.slice(prefix.length).split(/\s/u, 1)[0];

    expect(releaseAction).toBe('3bb12739c298aeb8a4eeaf626c5b8d85266b0e65');
    expect(releaseAction).toMatch(/^[a-f0-9]{40}$/u);
  });

  it('runs only for test pushes and queues releases without cancelling an older commit', async () => {
    const workflow = await readWorkflow();

    expect(workflow.on).toEqual({ push: { branches: ['test'] } });
    expect(workflow.concurrency).toEqual({
      group: 'relay-release-test',
      'cancel-in-progress': false,
    });
    expect(workflow.permissions).toEqual({ actions: 'read', checks: 'read', contents: 'read' });
  });

  it('waits for all protected gates on the exact test commit before versioning', async () => {
    const workflow = await readWorkflow();
    const gate = workflow.jobs.gates;
    const waitStep = findStep(gate, 'Wait for exact commit gates');
    const script = waitStep.with.script;

    expect(gate.outputs['source-sha']).toBe('${{ steps.required.outputs.source-sha }}');
    expect(waitStep.id).toBe('required');
    expect(waitStep.uses).toBe('actions/github-script@v8');
    expect(script).toContain("context.ref !== 'refs/heads/test'");
    expect(script).toContain('context.sha');
    expect(script).toContain("'Build quality gate'");
    expect(script).toContain("'SonarQube quality gate'");
    expect(script).toContain("'Snyk security gate'");
    expect(script).toContain("conclusion !== 'success'");
  });

  it('runs updater and private-DACL integration tests on Windows before packaging', async () => {
    const workflow = parse(await readFile(windowsWorkflowUrl, 'utf8'));
    const step = findStep(
      workflow.jobs.package,
      'Verify Windows updater and private directory security',
    );

    expect(step.run).toContain('src/main/releases');
    expect(step.run).toContain('WindowsPrivateDirectory.windows.test.ts');
    expect(
      workflow.jobs.package.steps.findIndex(
        (candidate) => candidate.name === 'Verify Windows updater and private directory security',
      ),
    ).toBeLessThan(
      workflow.jobs.package.steps.findIndex((candidate) => candidate.name === 'Build and package'),
    );
  });

  it('publishes a normal latest release with a versioned Windows ZIP and checksum', async () => {
    const workflow = await readWorkflow();
    const determine = workflow.jobs.determine;
    const packageJob = workflow.jobs['package-windows'];
    const release = workflow.jobs.release;
    const releaseStep = findStep(release, 'Create draft GitHub release');
    const replaceDraftStep = findStep(release, 'Replace incomplete draft release');
    const finalizeStep = findStep(release, 'Finalize immutable GitHub release');
    const assetStep = findStep(release, 'Create versioned release assets');
    const existingAssetStep = findStep(determine, 'Verify existing release assets');

    expect(determine.needs).toBe('gates');
    expect(determine.outputs['should-package']).toBe(
      '${{ steps.existing-assets.outputs.should-package || steps.release-state.outputs.should-package }}',
    );
    expect(findStep(determine, 'Checkout exact test commit').with).toEqual({
      'fetch-depth': 0,
      ref: '${{ needs.gates.outputs.source-sha }}',
    });
    expect(findStep(determine, 'Determine semantic version').run).toBe(
      'node scripts/release-version.mjs',
    );
    expect(existingAssetStep.if).toBe("steps.release-state.outputs.complete == 'true'");
    expect(existingAssetStep.env.ASSET_NAME).toBe(
      'Relay-${{ steps.version.outputs.tag }}-windows-x64.zip',
    );
    expect(existingAssetStep.run).toContain('gh release download');
    expect(existingAssetStep.run).toContain('sha256sum --check');
    expect(existingAssetStep.run).toContain('unzip -tqq "$ASSET_NAME"');
    expect(existingAssetStep.run).toContain('unzip -Z1 "$ASSET_NAME"');
    expect(existingAssetStep.env.SOURCE_SHA).toBe('${{ steps.version.outputs.source_sha }}');
    expect(existingAssetStep.run).toContain('.target_commitish');
    expect(existingAssetStep.run).toContain('.state == "uploaded"');
    expect(existingAssetStep.run).toContain('archive_digest');
    expect(existingAssetStep.run).toContain('checksum_digest');
    expect(findStep(determine, 'Resolve existing release state').with.script).not.toContain(
      'getLatestRelease',
    );
    expect(findStep(determine, 'Resolve existing release state').with.script).toContain(
      'Relay-${tag}-windows-x64.zip',
    );
    expect(findStep(determine, 'Resolve existing release state').with.script).toContain(
      'classifyExistingRelease',
    );
    expect(packageJob.needs).toBe('determine');
    expect(packageJob.if).toBe("needs.determine.outputs.should-package == 'true'");
    expect(packageJob.with).toMatchObject({
      'artifact-name': 'relay-windows',
      'baseline-branch': 'test',
      'baseline-workflow': 'release.yml',
      'release-version': '${{ needs.determine.outputs.version }}',
      'source-sha': '${{ needs.determine.outputs.source-sha }}',
    });
    expect(release.permissions).toEqual({ actions: 'read', contents: 'write' });
    expect(assetStep.run).toContain('Relay-${TAG}-windows-x64.zip');
    expect(assetStep.run).toContain('zip -j "$asset_name" Relay.exe');
    expect(assetStep.run).toContain('unzip -tqq "$asset_name"');
    expect(assetStep.run).toContain('unzip -Z1 "$asset_name"');
    expect(assetStep.run).toContain('sha256sum');
    expect(assetStep.run).toContain('archive_sha256=');
    expect(assetStep.run).toContain('checksum_sha256=');
    expect(releaseStep.with).toMatchObject({
      draft: true,
      generate_release_notes: true,
      make_latest: false,
      prerelease: false,
      tag_name: '${{ needs.determine.outputs.tag }}',
      target_commitish: '${{ needs.determine.outputs.source-sha }}',
    });
    expect(releaseStep.with.files).toContain('.sha256');
    expect(releaseStep.with).not.toHaveProperty('overwrite_files');
    expect(replaceDraftStep.uses).toBe('actions/github-script@v8');
    expect(replaceDraftStep.with.script).toContain('release.draft !== true');
    expect(replaceDraftStep.with.script).toContain("!['create', 'verify'].includes(action)");
    expect(replaceDraftStep.with.script).not.toContain("action !== 'verify'");
    expect(replaceDraftStep.with.script).toContain('deleteRelease');
    expect(replaceDraftStep.with.script).not.toContain('release.assets');
    expect(finalizeStep.uses).toBe('actions/github-script@v8');
    expect(finalizeStep.with.script).toContain('draft !== true');
    expect(finalizeStep.with.script).toContain('assets.length !== 2');
    expect(finalizeStep.with.script).toContain('digest');
    expect(finalizeStep.with.script).toContain('expectedDigests');
    expect(finalizeStep.with.script).toContain('getRef');
    expect(finalizeStep.with.script).toContain('createRef');
    expect(finalizeStep.with.script).toContain('ref: `refs/tags/${tag}`');
    expect(finalizeStep.with.script).toContain('sha: sourceSha');
    expect(finalizeStep.with.script).toContain('getTag');
    expect(finalizeStep.with.script.indexOf('createRef')).toBeLessThan(
      finalizeStep.with.script.indexOf('updateRelease'),
    );
    expect(finalizeStep.with.script.indexOf('getRef')).toBeLessThan(
      finalizeStep.with.script.indexOf('updateRelease'),
    );
    expect(finalizeStep.env.ARCHIVE_SHA256).toBe('${{ steps.assets.outputs.archive_sha256 }}');
    expect(finalizeStep.env.CHECKSUM_SHA256).toBe('${{ steps.assets.outputs.checksum_sha256 }}');
    expect(finalizeStep.with.script).toContain('draft: false');
    expect(finalizeStep.with.script).toContain("make_latest: 'true'");
    const publishedVerification = findStep(release, 'Verify published release').run;
    expect(publishedVerification).toContain('sha256sum --check');
    expect(publishedVerification).toContain('unzip -tqq "$ASSET_NAME"');
    expect(publishedVerification).toContain('unzip -Z1 "$ASSET_NAME"');
    expect(publishedVerification).toContain('--jq .immutable');
    expect(publishedVerification).toContain('map(.digest)');
  });

  it.each([
    ['a partial draft', [{ name: 'Relay-v1.2.3-windows-x64.zip' }]],
    [
      'a draft with an extra asset',
      [
        { name: 'Relay-v1.2.3-windows-x64.zip' },
        { name: 'Relay-v1.2.3-windows-x64.zip.sha256' },
        { name: 'unexpected.exe' },
      ],
    ],
  ])('repairs %s through clean draft replacement', (_label, assets) => {
    expect(
      classifyExistingRelease(
        {
          draft: true,
          prerelease: false,
          target_commitish: '0'.repeat(40),
          assets,
        },
        {
          expectedAsset: 'Relay-v1.2.3-windows-x64.zip',
          expectedChecksum: 'Relay-v1.2.3-windows-x64.zip.sha256',
          sourceSha: '0'.repeat(40),
        },
      ),
    ).toBe('replace-draft');
  });

  it('accepts only a complete published release with canonical source and asset metadata', () => {
    const sourceSha = '0'.repeat(40);
    const expectedAsset = 'Relay-v1.2.3-windows-x64.zip';
    const expectedChecksum = `${expectedAsset}.sha256`;
    const release = {
      draft: false,
      prerelease: false,
      target_commitish: sourceSha,
      assets: [
        {
          name: expectedAsset,
          state: 'uploaded',
          size: 100,
          digest: `sha256:${'a'.repeat(64)}`,
        },
        {
          name: expectedChecksum,
          state: 'uploaded',
          size: 95,
          digest: `sha256:${'b'.repeat(64)}`,
        },
      ],
    };

    expect(classifyExistingRelease(release, { expectedAsset, expectedChecksum, sourceSha })).toBe(
      'complete',
    );
    expect(() =>
      classifyExistingRelease(
        { ...release, target_commitish: '1'.repeat(40) },
        { expectedAsset, expectedChecksum, sourceSha },
      ),
    ).toThrow(/incomplete published/u);
    expect(() =>
      classifyExistingRelease(
        {
          ...release,
          assets: release.assets.map((asset, index) =>
            index === 0 ? { ...asset, digest: null } : asset,
          ),
        },
        { expectedAsset, expectedChecksum, sourceSha },
      ),
    ).toThrow(/incomplete published/u);
  });

  it('creates a checksum-valid ZIP containing only Relay.exe', async () => {
    const workflow = await readWorkflow();
    const assetScript = findStep(workflow.jobs.release, 'Create versioned release assets').run;
    const tempDir = await mkdtemp(join(tmpdir(), 'relay-release-assets-'));
    const releaseDir = join(tempDir, 'release');
    const outputFile = join(tempDir, 'github-output.txt');
    const tag = 'v1.2.3';
    const assetName = `Relay-${tag}-windows-x64.zip`;

    try {
      await mkdir(releaseDir);
      await writeFile(join(releaseDir, 'Relay.exe'), 'verified relay executable');
      await execFileAsync('bash', ['-c', assetScript], {
        cwd: tempDir,
        env: { ...process.env, GITHUB_OUTPUT: outputFile, TAG: tag },
      });

      const { stdout: members } = await execFileAsync('unzip', [
        '-Z1',
        join(releaseDir, assetName),
      ]);
      expect(members.trim().split(/\r?\n/u)).toEqual(['Relay.exe']);

      await expect(
        execFileAsync('sha256sum', ['--check', `${assetName}.sha256`], { cwd: releaseDir }),
      ).resolves.toMatchObject({ stdout: `${assetName}: OK\n` });
      const outputs = await readFile(outputFile, 'utf8');
      expect(outputs).toContain(`asset_name=${assetName}\n`);
      expect(outputs).toMatch(/archive_sha256=[0-9a-f]{64}\n/u);
      expect(outputs).toMatch(/checksum_sha256=[0-9a-f]{64}\n/u);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('documents the public download and automatic test-branch release contract in living docs', async () => {
    const [readme, development, architecture, design, security] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/DEVELOPMENT.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/DESIGN.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/SECURITY.md', import.meta.url), 'utf8'),
    ]);

    expect(readme).toContain('https://github.com/CrimsonSoul/Relay/releases/latest');
    expect(development).toContain('## Automated Releases');
    expect(development).toContain('Build quality gate');
    expect(development).toContain('SonarQube quality gate');
    expect(development).toContain('Snyk security gate');
    expect(development).toContain('Relay-vX.Y.Z-windows-x64.zip');
    expect(development).toContain('Relay-vX.Y.Z-windows-x64.zip.sha256');
    expect(development).toContain('draft release');
    expect(development).toContain('Download update');
    expect(architecture).toContain(
      'Release versions are derived from conventional commits on `test`',
    );
    expect(architecture).toContain('ReleaseUpdateManager');
    expect(design).toContain('Update Relay');
    expect(security).toContain('publisher signing');
  });
});
