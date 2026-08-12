import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowUrl = new URL('../.github/workflows/release.yml', import.meta.url);
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

  it('publishes a normal latest release with a versioned Windows asset and checksum', async () => {
    const workflow = await readWorkflow();
    const determine = workflow.jobs.determine;
    const packageJob = workflow.jobs['package-windows'];
    const release = workflow.jobs.release;
    const releaseStep = findStep(release, 'Publish GitHub release');
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
    expect(existingAssetStep.run).toContain('gh release download');
    expect(existingAssetStep.run).toContain('sha256sum --check');
    expect(findStep(determine, 'Resolve existing release state').with.script).not.toContain(
      'getLatestRelease',
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
    expect(assetStep.run).toContain('Relay-${TAG}-windows-x64.exe');
    expect(assetStep.run).toContain('sha256sum');
    expect(releaseStep.with).toMatchObject({
      draft: false,
      generate_release_notes: true,
      make_latest: true,
      prerelease: false,
      tag_name: '${{ needs.determine.outputs.tag }}',
      target_commitish: '${{ needs.determine.outputs.source-sha }}',
    });
    expect(releaseStep.with.files).toContain('.sha256');
    expect(findStep(release, 'Verify published release').run).toContain('sha256sum --check');
  });

  it('documents the public download and automatic test-branch release contract in living docs', async () => {
    const [readme, development, architecture] = await Promise.all([
      readFile(new URL('../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/DEVELOPMENT.md', import.meta.url), 'utf8'),
      readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8'),
    ]);

    expect(readme).toContain('https://github.com/CrimsonSoul/Relay/releases/latest');
    expect(development).toContain('## Automated Releases');
    expect(development).toContain('Build quality gate');
    expect(development).toContain('SonarQube quality gate');
    expect(development).toContain('Snyk security gate');
    expect(development).toContain('Relay-vX.Y.Z-windows-x64.exe');
    expect(development).toContain('SHA-256');
    expect(architecture).toContain(
      'Release versions are derived from conventional commits on `test`',
    );
  });
});
