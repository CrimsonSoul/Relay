import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowsDirectory = new URL('../.github/workflows/', import.meta.url);
const workflowPath = (name) => new URL(name, workflowsDirectory);
const readWorkflow = async (name) => parse(await readFile(workflowPath(name), 'utf8'));
const expression = (value) => String(value).replaceAll(/\s+/gu, ' ').trim();
const findStep = (job, name) => job.steps.find((step) => step.name === name);

describe('CI workflow contracts', () => {
  it('parses every workflow and takes every setup-node version from .node-version', async () => {
    const names = (await readdir(workflowsDirectory)).filter((name) => /\.ya?ml$/u.test(name));

    for (const name of names) {
      const workflow = await readWorkflow(name);
      expect(workflow, `${name} must parse to a mapping`).toBeTypeOf('object');
      for (const job of Object.values(workflow.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (!String(step.uses ?? '').startsWith('actions/setup-node@')) continue;
          expect(step.with?.['node-version-file'], `${name}: ${step.name}`).toBe('.node-version');
          expect(step.with, `${name}: ${step.name}`).not.toHaveProperty('node-version');
        }
      }
    }
  });

  it('defines an explicit reusable Windows packaging interface and restricted authority', async () => {
    const workflow = await readWorkflow('reusable-windows-package.yml');
    const call = workflow.on.workflow_call;

    expect(call.inputs).toEqual({
      'artifact-name': {
        description: 'Artifact name uploaded by the packaging job.',
        required: true,
        type: 'string',
      },
      'baseline-branch': {
        description: 'Branch used to find the previous successful Windows artifact.',
        required: true,
        type: 'string',
      },
      compression: {
        description: 'electron-builder compression mode for the production artifact.',
        required: true,
        type: 'string',
      },
      publish: {
        description: 'electron-builder publish policy.',
        required: true,
        type: 'string',
      },
    });
    expect(call.secrets).toEqual({
      'github-token': {
        description: 'Token used only to read previous workflow artifacts.',
        required: true,
      },
    });
    expect(call.outputs?.['artifact-name']?.value).toBe(
      '${{ jobs.package.outputs.artifact-name }}',
    );
    expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read' });

    const packageJob = workflow.jobs.package;
    expect(packageJob['runs-on']).toBe('windows-latest');
    expect(packageJob.env.RELAY_BUILD_ID).toBe('r1-${{ github.sha }}');
    expect(packageJob.outputs['artifact-name']).toBe('${{ inputs.artifact-name }}');
    expect(findStep(packageJob, 'Setup Node.js').with['node-version-file']).toBe('.node-version');
    expect(findStep(packageJob, 'Get PocketBase version').run).toContain('--print-version');
    expect(findStep(packageJob, 'Find previous successful Windows artifact').env.GH_TOKEN).toBe(
      "${{ secrets['github-token'] }}",
    );
    expect(
      findStep(packageJob, 'Find previous successful Windows artifact').env.BASELINE_BRANCH,
    ).toBe('${{ inputs.baseline-branch }}');
    const buildStep = findStep(packageJob, 'Build and package');
    expect(buildStep.env).toEqual({
      COMPRESSION: '${{ inputs.compression }}',
      PUBLISH_POLICY: '${{ inputs.publish }}',
    });
    expect(buildStep.run).toContain('--config.compression="$env:COMPRESSION"');
    expect(buildStep.run).toContain('--publish "$env:PUBLISH_POLICY"');
    expect(buildStep.run).not.toContain('${{ inputs.');
    const benchmarkStep = findStep(packageJob, 'Benchmark packaged startup paths');
    expect(benchmarkStep.env.COMPRESSION).toBe('${{ inputs.compression }}');
    expect(benchmarkStep.run).not.toContain('${{ inputs.compression }}');
    expect(findStep(packageJob, 'Upload packaged startup diagnostics').if).toBe('failure()');
    expect(findStep(packageJob, 'Upload artifact').with.name).toBe('${{ inputs.artifact-name }}');
  });

  it('keeps branch and release callers valid while preserving their legitimate differences', async () => {
    const [build, release] = await Promise.all([
      readWorkflow('build.yml'),
      readWorkflow('release.yml'),
    ]);
    const buildPackage = build.jobs['package-windows'];
    const releasePackage = release.jobs['package-windows'];

    expect(build.jobs.quality.name).toBe('Build quality gate');
    expect(buildPackage.uses).toBe('./.github/workflows/reusable-windows-package.yml');
    expect(expression(buildPackage.if)).toContain("github.event_name == 'workflow_dispatch'");
    expect(buildPackage).not.toHaveProperty('needs');
    expect(buildPackage.with).toEqual({
      'artifact-name': 'relay-windows',
      'baseline-branch': '${{ github.ref_name }}',
      compression: 'store',
      publish: 'never',
    });
    expect(buildPackage.secrets).toEqual({ 'github-token': '${{ secrets.GITHUB_TOKEN }}' });

    expect(releasePackage.uses).toBe('./.github/workflows/reusable-windows-package.yml');
    expect(releasePackage.with).toEqual({
      'artifact-name': 'relay-windows',
      'baseline-branch': 'main',
      compression: 'normal',
      publish: 'never',
    });
    expect(releasePackage.secrets).toEqual({ 'github-token': '${{ secrets.GITHUB_TOKEN }}' });
    expect(release.jobs.release.needs).toEqual(['quality', 'package-windows']);
    expect(findStep(release.jobs.release, 'Download Windows artifact').with.name).toBe(
      '${{ needs.package-windows.outputs.artifact-name }}',
    );
  });

  it('builds the startup comparison once after native rebuild and only repackages candidates', async () => {
    const workflow = await readWorkflow('windows-startup-comparison.yml');
    const steps = workflow.jobs.compare.steps;
    const commands = steps.map((step) => String(step.run ?? ''));
    const nativeIndex = steps.findIndex(
      (step) => step.name === 'Install Electron native dependencies',
    );
    const buildIndex = steps.findIndex((step) => step.name === 'Build Relay once');
    const candidateIndexes = [
      'Build store candidate',
      'Build normal candidate',
      'Build maximum candidate',
    ].map((name) => steps.findIndex((step) => step.name === name));

    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(commands.filter((command) => command.includes('npm run build'))).toHaveLength(1);
    expect(nativeIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(nativeIndex);
    for (const candidateIndex of candidateIndexes) {
      expect(candidateIndex).toBeGreaterThan(buildIndex);
      expect(steps[candidateIndex].run).toContain('node scripts/package-windows.mjs');
      expect(steps[candidateIndex].run).toContain('--config.npmRebuild=false');
      expect(steps[candidateIndex].run).not.toContain('npm run package:win');
    }
    expect(
      findStep(workflow.jobs.compare, 'Build former maximum-compression portable baseline').run,
    ).toContain('--config.npmRebuild=false');
  });
});
