import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowsDirectory = new URL('../.github/workflows/', import.meta.url);
const workflowPath = (name) => new URL(name, workflowsDirectory);
const readWorkflow = async (name) => parse(await readFile(workflowPath(name), 'utf8'));
const readWorkflowNames = async (readDirectory = readdir) =>
  (await readDirectory(workflowsDirectory))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
const expression = (value) => String(value).replaceAll(/\s+/gu, ' ').trim();
const findStep = (job, name) => job.steps.find((step) => step.name === name);

describe('CI workflow contracts', () => {
  it('normalizes workflow enumeration before order-sensitive collection', async () => {
    const names = await readWorkflowNames(async () => [
      'windows-startup-comparison.yml',
      'notes.txt',
      'release.yml',
      'build.yml',
    ]);

    expect(names).toEqual(['build.yml', 'release.yml', 'windows-startup-comparison.yml']);
  });

  it('parses every workflow and takes every setup-node version from .node-version', async () => {
    const names = await readWorkflowNames();

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
      'baseline-workflow': {
        description: 'Workflow used to find the previous successful Windows artifact.',
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
      'release-version': {
        default: '',
        description: 'Normal semantic version embedded in a release package.',
        required: false,
        type: 'string',
      },
      'source-sha': {
        description: 'Exact source commit packaged by the caller.',
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
    expect(packageJob.env.RELAY_BUILD_ID).toBe('r1-${{ inputs.source-sha }}');
    expect(packageJob.outputs['artifact-name']).toBe('${{ inputs.artifact-name }}');
    expect(findStep(packageJob, 'Checkout repository').with.ref).toBe('${{ inputs.source-sha }}');
    expect(findStep(packageJob, 'Setup Node.js').with['node-version-file']).toBe('.node-version');
    expect(findStep(packageJob, 'Get PocketBase version').run).toContain('--print-version');
    expect(findStep(packageJob, 'Find previous successful Windows artifact').env.GH_TOKEN).toBe(
      "${{ secrets['github-token'] }}",
    );
    expect(
      findStep(packageJob, 'Find previous successful Windows artifact').env.BASELINE_BRANCH,
    ).toBe('${{ inputs.baseline-branch }}');
    expect(
      findStep(packageJob, 'Find previous successful Windows artifact').env.BASELINE_WORKFLOW,
    ).toBe('${{ inputs.baseline-workflow }}');
    const buildStep = findStep(packageJob, 'Build and package');
    expect(buildStep.env).toEqual({
      COMPRESSION: '${{ inputs.compression }}',
      PUBLISH_POLICY: '${{ inputs.publish }}',
      RELAY_RELEASE_VERSION: '${{ inputs.release-version }}',
    });
    expect(buildStep.run).toContain('--config.compression="$env:COMPRESSION"');
    expect(buildStep.run).toContain('--publish "$env:PUBLISH_POLICY"');
    expect(buildStep.run).not.toContain('${{ inputs.');
    const versionStep = findStep(packageJob, 'Verify packaged release version');
    expect(versionStep.if).toBe("inputs.release-version != ''");
    expect(versionStep.env.RELAY_RELEASE_VERSION).toBe('${{ inputs.release-version }}');
    expect(versionStep.run).toContain("(Get-Item -LiteralPath './release/Relay.exe').VersionInfo");
    expect(versionStep.run).toContain('$actualCore -ne $env:RELAY_RELEASE_VERSION');
    const smokeStep = findStep(packageJob, 'Smoke test persistent bootstrap');
    expect(smokeStep.env.RELAY_EXPECTED_TARGET_COMMITISH).toBe('${{ inputs.source-sha }}');
    expect(smokeStep.run).toContain('-ExpectedTargetCommitish');
    const benchmarkStep = findStep(packageJob, 'Benchmark packaged startup paths');
    expect(benchmarkStep.env.COMPRESSION).toBe('${{ inputs.compression }}');
    expect(benchmarkStep.run).not.toContain('${{ inputs.compression }}');
    expect(findStep(packageJob, 'Upload packaged startup diagnostics').if).toBe('failure()');
    expect(findStep(packageJob, 'Upload artifact').with.name).toBe('${{ inputs.artifact-name }}');
  });

  it('keeps every explicit cache failure-tolerant with exact dependency identity', async () => {
    const names = await readWorkflowNames();
    const caches = [];

    for (const name of names) {
      const workflow = await readWorkflow(name);
      for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (!String(step.uses ?? '').startsWith('actions/cache@')) continue;
          caches.push({
            continueOnError: step['continue-on-error'],
            job: jobName,
            key: step.with?.key,
            name,
            path: step.with?.path,
            restoreKeys: step.with?.['restore-keys'],
            step: step.name,
          });
        }
      }
    }

    expect(caches).toEqual([
      {
        continueOnError: true,
        job: 'static',
        key: 'electron-linux-x64-${{ steps.electron-version.outputs.version }}',
        name: 'build.yml',
        path: '~/.cache/electron',
        restoreKeys: undefined,
        step: 'Cache Electron binary',
      },
      {
        continueOnError: true,
        job: 'static',
        key: "eslint-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', 'eslint.config.js', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.renderer.json') }}-${{ github.sha }}",
        name: 'build.yml',
        path: '.cache/eslint',
        restoreKeys: undefined,
        step: 'Cache ESLint results',
      },
      {
        continueOnError: true,
        job: 'static',
        key: "prettier-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', '.prettierrc', '.prettierignore') }}-${{ github.sha }}",
        name: 'build.yml',
        path: '.cache/prettier',
        restoreKeys:
          "prettier-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', '.prettierrc', '.prettierignore') }}-",
        step: 'Cache Prettier results',
      },
      {
        continueOnError: true,
        job: 'package',
        key: 'electron-win-x64-${{ steps.electron-version.outputs.version }}',
        name: 'reusable-windows-package.yml',
        path: '~/AppData/Local/electron/Cache\n.electron\n',
        restoreKeys: undefined,
        step: 'Cache Electron binary',
      },
      {
        continueOnError: true,
        job: 'package',
        key: "electron-builder-win-${{ hashFiles('package-lock.json') }}",
        name: 'reusable-windows-package.yml',
        path: '~/AppData/Local/electron-builder/Cache',
        restoreKeys: 'electron-builder-win-',
        step: 'Cache electron-builder tooling',
      },
      {
        continueOnError: true,
        job: 'package',
        key: 'electron-gyp-win-${{ steps.electron-version.outputs.version }}',
        name: 'reusable-windows-package.yml',
        path: '~/.electron-gyp',
        restoreKeys: undefined,
        step: 'Cache Electron headers',
      },
      {
        continueOnError: true,
        job: 'package',
        key: 'pocketbase-win32-x64-${{ steps.pocketbase-version.outputs.version }}',
        name: 'reusable-windows-package.yml',
        path: 'resources/pocketbase/win32-x64',
        restoreKeys: undefined,
        step: 'Cache PocketBase binary',
      },
      {
        continueOnError: true,
        job: 'package',
        key: "better-sqlite3-electron-win-${{ steps.electron-version.outputs.version }}-${{ hashFiles('package-lock.json') }}",
        name: 'reusable-windows-package.yml',
        path: 'node_modules/better-sqlite3/build/Release',
        restoreKeys: undefined,
        step: 'Cache rebuilt better-sqlite3',
      },
      {
        continueOnError: true,
        job: 'sonarqube',
        key: "sonar-${{ runner.os }}-${{ hashFiles('package-lock.json') }}",
        name: 'security.yml',
        path: '~/.sonar/cache',
        restoreKeys: undefined,
        step: 'Cache Sonar packages',
      },
      {
        continueOnError: true,
        job: 'compare',
        key: "startup-comparison-win-${{ steps.electron-version.outputs.version }}-${{ hashFiles('package-lock.json') }}",
        name: 'windows-startup-comparison.yml',
        path: '~/AppData/Local/electron/Cache\n~/AppData/Local/electron-builder/Cache\n~/.electron-gyp\n.electron\n',
        restoreKeys: undefined,
        step: 'Cache Electron and packaging tools',
      },
    ]);
  });

  it('passes the complete previous-artifact lookup contract', async () => {
    const workflow = await readWorkflow('reusable-windows-package.yml');
    const previous = findStep(workflow.jobs.package, 'Find previous successful Windows artifact');

    expect(previous).toMatchObject({
      env: {
        BASELINE_BRANCH: '${{ inputs.baseline-branch }}',
        BASELINE_WORKFLOW: '${{ inputs.baseline-workflow }}',
        GH_TOKEN: "${{ secrets['github-token'] }}",
        SOURCE_SHA: '${{ inputs.source-sha }}',
      },
      id: 'previous',
      shell: 'pwsh',
    });
    expect(previous.run).toBe(
      './scripts/find-previous-windows-artifact.ps1 -Workflow "$env:BASELINE_WORKFLOW" -Branch "$env:BASELINE_BRANCH" -CurrentSha "$env:SOURCE_SHA" -Destination "$env:RUNNER_TEMP\\RelayPrevious.exe"',
    );
    expect(previous.run).not.toContain('${{ inputs.');
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
    expect(expression(buildPackage.if)).toBe(
      "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main')",
    );
    expect(buildPackage).not.toHaveProperty('needs');
    expect(buildPackage.with).toEqual({
      'artifact-name': 'relay-windows',
      'baseline-branch': '${{ github.ref_name }}',
      'baseline-workflow': 'build.yml',
      compression: 'store',
      publish: 'never',
      'source-sha': '${{ github.sha }}',
    });
    expect(buildPackage.secrets).toEqual({ 'github-token': '${{ secrets.GITHUB_TOKEN }}' });

    expect(releasePackage.uses).toBe('./.github/workflows/reusable-windows-package.yml');
    expect(releasePackage.needs).toBe('determine');
    expect(releasePackage.if).toBe("needs.determine.outputs.should-package == 'true'");
    expect(releasePackage.with).toEqual({
      'artifact-name': 'relay-windows',
      'baseline-branch': 'main',
      'baseline-workflow': 'release.yml',
      compression: 'normal',
      publish: 'never',
      'release-version': '${{ needs.determine.outputs.version }}',
      'source-sha': '${{ needs.determine.outputs.source-sha }}',
    });
    expect(releasePackage.secrets).toEqual({ 'github-token': '${{ secrets.GITHUB_TOKEN }}' });
    expect(release.jobs.release.needs).toEqual(['gates', 'determine', 'package-windows']);
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
