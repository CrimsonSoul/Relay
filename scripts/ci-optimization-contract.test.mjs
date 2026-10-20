import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { COVERAGE_JOBS } from './wait-for-coverage.mjs';
import unitConfig from '../vitest.config.ts';
import cacheConfig from '../vitest.cache.config.ts';
import rendererConfig from '../vitest.renderer.config.ts';
import verificationConfig from '../vitest.verify.config.ts';
import { runWorkflowBash, withPathPrepended } from './workflow-bash.mjs';

const projectRoot = new URL('../', import.meta.url);
const readProjectFile = async (path) => readFile(new URL(path, projectRoot), 'utf8');
const readJson = async (path) => JSON.parse(await readProjectFile(path));
const readYaml = async (path) => parse(await readProjectFile(path));
const findStep = (job, name) => job.steps.find((step) => step.name === name);
const normalizeExpression = (value) => String(value).replaceAll(/\s+/gu, ' ').trim();
const runBuildGate = async (env) => {
  const build = await readYaml('.github/workflows/build.yml');
  const aggregate = findStep(build.jobs.quality, 'Require successful build components');
  return runWorkflowBash(['--noprofile', '--norc', '-eo', 'pipefail', '-c', aggregate.run], {
    encoding: 'utf8',
    env: {
      STATIC_RESULT: 'success',
      UNIT_COVERAGE_RESULT: 'success',
      RENDERER_COVERAGE_RESULT: 'success',
      WINDOWS_UNIT_RESULT: 'success',
      WORKFLOW_TESTS_RESULT: 'success',
      WINDOWS_PACKAGE_SCOPE_RESULT: 'success',
      WINDOWS_PACKAGE_REQUIRED: 'false',
      WINDOWS_PACKAGE_RESULT: 'skipped',
      ...env,
    },
  });
};
const buildComponents = [
  'STATIC_RESULT',
  'UNIT_COVERAGE_RESULT',
  'RENDERER_COVERAGE_RESULT',
  'WINDOWS_UNIT_RESULT',
  'WORKFLOW_TESTS_RESULT',
  'WINDOWS_PACKAGE_SCOPE_RESULT',
];

describe('CI optimization contracts', () => {
  it('keeps passing test output quiet in every Vitest suite', () => {
    for (const config of [unitConfig, cacheConfig, rendererConfig, verificationConfig]) {
      expect(config.test.silent).toBe('passed-only');
    }
  });

  it('uses content-addressed local static-analysis caches', async () => {
    const [gitignore, pkg] = await Promise.all([
      readProjectFile('.gitignore'),
      readJson('package.json'),
    ]);

    expect(gitignore).toContain('.cache/');
    expect(pkg.scripts.lint).toContain('--max-warnings 0');
    expect(pkg.scripts.lint).toContain('--cache --cache-location .cache/eslint');
    expect(pkg.scripts.lint).toContain('--cache-strategy content');
    expect(pkg.scripts['format:check']).toContain('--cache --cache-location .cache/prettier');
    expect(pkg.scripts['format:check']).toContain('--cache-strategy content');
  });

  it('restores safe content-addressed static-analysis caches across commits', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const eslintCache = findStep(build.jobs.static, 'Cache ESLint results');
    const prettierCache = findStep(build.jobs.static, 'Cache Prettier results');

    expect(eslintCache).toEqual({
      name: 'Cache ESLint results',
      'continue-on-error': true,
      uses: 'actions/cache@caa296126883cff596d87d8935842f9db880ef25',
      with: {
        path: '.cache/eslint',
        key: "eslint-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', 'eslint.config.js', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.renderer.json') }}-${{ github.sha }}",
        'restore-keys':
          "eslint-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', 'eslint.config.js', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.renderer.json') }}-",
      },
    });

    expect(prettierCache).toEqual({
      name: 'Cache Prettier results',
      'continue-on-error': true,
      uses: 'actions/cache@caa296126883cff596d87d8935842f9db880ef25',
      with: {
        path: '.cache/prettier',
        key: "prettier-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', '.prettierrc', '.prettierignore') }}-${{ github.sha }}",
        'restore-keys':
          "prettier-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', '.prettierrc', '.prettierignore') }}-",
      },
    });
  });

  it('runs the canonical coverage suites once behind a fail-closed aggregate build gate', async () => {
    const build = await readYaml('.github/workflows/build.yml');

    for (const jobName of ['static', 'unit-coverage', 'renderer-coverage', 'windows-unit']) {
      expect(build.jobs[jobName]).not.toHaveProperty('needs');
      expect(build.jobs[jobName]).not.toHaveProperty('if');
    }
    expect(build.jobs).not.toHaveProperty('unit-tests');
    expect(build.jobs).not.toHaveProperty('renderer-tests');
    expect(build.jobs['renderer-coverage'].strategy).toEqual({
      'fail-fast': false,
      matrix: {
        'shard-index': [1, 2, 3, 4],
        'shard-total': [4],
      },
    });
    expect(
      findStep(build.jobs['renderer-coverage'], 'Generate renderer coverage shard').run,
    ).toContain('--shard=${{ matrix.shard-index }}/${{ matrix.shard-total }}');
    expect(findStep(build.jobs['unit-coverage'], 'Generate unit coverage').run).toContain(
      'npm run test:coverage',
    );
    expect(findStep(build.jobs['unit-coverage'], 'Run cache integration tests').run).toBe(
      'npm run test:cache',
    );

    const quality = build.jobs.quality;
    expect(quality.name).toBe('Build quality gate');
    expect(quality.if).toBe('always()');
    expect(quality.needs).toEqual([
      'static',
      'unit-coverage',
      'renderer-coverage',
      'windows-unit',
      'workflow-tests',
      'windows-package-scope',
      'package-windows',
    ]);
    const aggregate = findStep(quality, 'Require successful build components');
    expect(aggregate.env).toEqual({
      RENDERER_COVERAGE_RESULT: '${{ needs.renderer-coverage.result }}',
      STATIC_RESULT: '${{ needs.static.result }}',
      UNIT_COVERAGE_RESULT: '${{ needs.unit-coverage.result }}',
      WINDOWS_PACKAGE_REQUIRED: '${{ needs.windows-package-scope.outputs.required }}',
      WINDOWS_PACKAGE_RESULT: '${{ needs.package-windows.result }}',
      WINDOWS_PACKAGE_SCOPE_RESULT: '${{ needs.windows-package-scope.result }}',
      WINDOWS_UNIT_RESULT: '${{ needs.windows-unit.result }}',
      WORKFLOW_TESTS_RESULT: '${{ needs.workflow-tests.result }}',
    });
    expect(quality.steps).toHaveLength(1);
  });

  it('runs the main-process and script suites natively on Windows for every build', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const windows = build.jobs['windows-unit'];

    expect(windows.name).toBe('Windows unit tests');
    expect(windows['runs-on']).toBe('windows-latest');
    expect(windows['continue-on-error']).not.toBe(true);
    expect(findStep(windows, 'Install dependencies')).toMatchObject({
      env: { RELAY_SKIP_POCKETBASE_DOWNLOAD: '1' },
      run: 'npm ci --prefer-offline',
    });
    // One command per step: the Windows default shell reports only the last exit code.
    expect(findStep(windows, 'Run unit tests').run).toBe('npm run test:unit');
    expect(findStep(windows, 'Run cache integration tests').run).toBe('npm run test:cache');
    for (const step of windows.steps) {
      expect(step['continue-on-error']).not.toBe(true);
      expect(String(step.run ?? '').trim()).not.toContain('\n');
    }
  });

  it('runs every integration suite in isolated jobs through ABI-restoring npm scripts on every build', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const workflows = build.jobs['workflow-tests'];

    expect(workflows).toBeDefined();
    expect(workflows).not.toHaveProperty('if');
    expect(workflows).not.toHaveProperty('needs');
    expect(workflows['runs-on']).toBe('ubuntu-24.04');
    expect(workflows['continue-on-error']).not.toBe(true);
    expect(workflows.strategy['fail-fast']).toBe(false);
    expect(workflows.strategy.matrix).toEqual({
      include: [
        { suite: 'electron', 'shard-index': 1, 'shard-total': 4 },
        { suite: 'electron', 'shard-index': 2, 'shard-total': 4 },
        { suite: 'electron', 'shard-index': 3, 'shard-total': 4 },
        { suite: 'electron', 'shard-index': 4, 'shard-total': 4 },
        { suite: 'web', 'shard-index': 1, 'shard-total': 1 },
      ],
    });
    expect(workflows.env?.RELAY_SKIP_POCKETBASE_DOWNLOAD).not.toBe('1');
    const install = findStep(workflows, 'Install dependencies');
    expect(install.run).toBe('npm ci --prefer-offline');
    expect(install.env?.RELAY_SKIP_POCKETBASE_DOWNLOAD).not.toBe('1');
    const pocketbase = findStep(workflows, 'Verify PocketBase replay against real storage');
    expect(pocketbase).toBeDefined();
    expect(pocketbase.run).toBe(
      'npm run test:pocketbase -- verification/offline-replay-real-pb.test.ts verification/dynatrace-pipeline.test.ts',
    );
    const browsers = findStep(workflows, 'Install Playwright browsers and Linux dependencies');
    expect(browsers.run).toBe('npx playwright install --with-deps chromium webkit');
    const electronDependencies = findStep(workflows, 'Install Electron Linux dependencies');
    expect(electronDependencies.run).toBe('npx playwright install-deps chromium');
    const electron = findStep(workflows, 'Run Electron workflows');
    const web = findStep(workflows, 'Run browser workflows');
    const pkg = await readJson('package.json');
    expect(pkg.scripts['test:electron']).toBe(
      'npm run build && node scripts/run-electron-tests.mjs',
    );
    const runner = await readProjectFile('scripts/run-electron-tests.mjs');
    expect(runner).toContain('writeElectronShard(');
    expect(runner.indexOf('writeElectronShard(balanced')).toBeLessThan(
      runner.indexOf('runElectronTests({'),
    );

    expect(electron.run).toContain('sudo apt-get install --yes dbus-x11 gnome-keyring');
    expect(electron.run).toContain('dbus-run-session -- bash -euo pipefail');
    expect(electron.run).toContain(
      'openssl rand -hex 32 | gnome-keyring-daemon --unlock --components=secrets',
    );
    expect(electron.run).toContain(
      'xvfb-run --auto-servernum npm run test:electron -- --fully-parallel --workers=1 --balanced-shard=${{ matrix.shard-index }}/${{ matrix.shard-total }}',
    );
    expect(web.run).toBe('xvfb-run --auto-servernum npm run test:web');
    expect(workflows.steps.indexOf(pocketbase)).toBeGreaterThan(workflows.steps.indexOf(install));
    expect(workflows.steps.indexOf(browsers)).toBeGreaterThan(workflows.steps.indexOf(pocketbase));
    expect(workflows.steps.indexOf(electron)).toBeGreaterThan(
      workflows.steps.indexOf(electronDependencies),
    );
    expect(workflows.steps.indexOf(web)).toBeGreaterThan(workflows.steps.indexOf(browsers));
    expect(install).not.toHaveProperty('if');
    for (const step of [pocketbase, browsers, web]) {
      expect(step.if).toBe("matrix.suite == 'web'");
    }
    for (const step of [electronDependencies, electron]) {
      expect(step.if).toBe("matrix.suite == 'electron'");
    }
    for (const step of [install, pocketbase, browsers, electronDependencies, electron, web]) {
      expect(step['continue-on-error']).not.toBe(true);
    }
    const failures = findStep(workflows, 'Upload workflow failure details');
    expect(failures.if).toBe('failure()');
    expect(failures.with.name).toBe(
      'workflow-test-failures-${{ matrix.suite }}-${{ matrix.shard-index }}',
    );
  });

  it('accepts successful build components', async () => {
    const outcome = await runBuildGate({});
    expect(outcome.error).toBeUndefined();
    expect(outcome.status, outcome.stdout + outcome.stderr).toBe(0);
  });

  it.each([
    ['true', 'success', 0],
    ['false', 'skipped', 0],
    ['true', 'skipped', 1],
    ['true', 'failure', 1],
    ['true', 'cancelled', 1],
    ['false', 'success', 1],
    ['false', 'failure', 1],
    ['', 'skipped', 1],
  ])(
    'matches Windows packaging to its scope (required=%s, package=%s)',
    async (required, result, status) => {
      const outcome = await runBuildGate({
        WINDOWS_PACKAGE_REQUIRED: required,
        WINDOWS_PACKAGE_RESULT: result,
      });
      expect(outcome.error).toBeUndefined();
      expect(outcome.status, outcome.stdout + outcome.stderr).toBe(status);
    },
  );

  it('packages Windows on pull requests that touch its paths', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const scope = build.jobs['windows-package-scope'];

    expect(scope).not.toHaveProperty('needs');
    expect(scope).not.toHaveProperty('permissions');
    expect(scope.outputs).toEqual({ required: '${{ steps.scope.outputs.required }}' });
    expect(findStep(scope, 'Checkout repository').with).toEqual({ 'fetch-depth': 2 });
    const resolve = findStep(scope, 'Resolve Windows package scope');
    expect(resolve.id).toBe('scope');
    expect(resolve.run).toContain('git diff --no-renames --name-only HEAD^1 HEAD > "$changed"');
    expect(resolve.run).toContain('node scripts/windows-package-scope.mjs < "$changed"');

    const packageJob = build.jobs['package-windows'];
    expect(packageJob.needs).toBe('windows-package-scope');
    expect(packageJob.if).toBe("needs.windows-package-scope.outputs.required == 'true'");
  });

  it('lists exactly the merge commit changes for the scope decision', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const resolve = findStep(build.jobs['windows-package-scope'], 'Resolve Windows package scope');
    const root = await mkdtemp(join(tmpdir(), 'relay-windows-scope-git-'));
    try {
      const git = (...args) =>
        runWorkflowBash(['-eo', 'pipefail', '-c', `git ${args.join(' ')}`], {
          cwd: root,
          encoding: 'utf8',
        });
      const output = join(root, 'output.txt');
      await writeFile(output, '');
      await mkdir(join(root, 'scripts'));
      await writeFile(
        join(root, 'scripts', 'windows-package-scope.mjs'),
        await readProjectFile('scripts/windows-package-scope.mjs'),
      );
      expect(git('init', '-q').status).toBe(0);
      expect(git('-c user.name=t -c user.email=t@t commit -q --allow-empty -m base').status).toBe(
        0,
      );
      await mkdir(join(root, 'src', 'main', 'releases'), { recursive: true });
      await writeFile(join(root, 'src', 'main', 'releases', 'a.ts'), '');
      expect(git('add', '-A').status).toBe(0);
      expect(git('-c user.name=t -c user.email=t@t commit -q -m change').status).toBe(0);
      const result = runWorkflowBash(['-eo', 'pipefail', '-c', resolve.run], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_OUTPUT: output,
          RUNNER_TEMP: root,
        },
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(await readFile(output, 'utf8')).toBe('required=true\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  describe.each(buildComponents)('Build gate component %s', (component) => {
    it.each(['failure', 'cancelled', 'skipped', 'neutral', 'pending', ''])(
      'rejects result "%s"',
      async (result) => {
        const outcome = await runBuildGate({ [component]: result });
        expect(outcome.error).toBeUndefined();
        expect(outcome.status, outcome.stdout + outcome.stderr).toBe(1);
      },
    );
  });

  it('merges all four renderer coverage shards before the Sonar scan', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const rendererCoverage = build.jobs['renderer-coverage'];

    expect(rendererCoverage.strategy).toEqual({
      'fail-fast': false,
      matrix: {
        'shard-index': [1, 2, 3, 4],
        'shard-total': [4],
      },
    });
    const rendererCommand = findStep(rendererCoverage, 'Generate renderer coverage shard').run;
    expect(rendererCommand).toContain('--reporter=dot');
    expect(rendererCommand).toContain('--reporter=blob');
    expect(rendererCommand).toContain(
      '--shard=${{ matrix.shard-index }}/${{ matrix.shard-total }}',
    );

    const sonar = build.jobs.sonarqube;
    expect(sonar.name).toBe('SonarQube quality gate');
    expect(sonar).not.toHaveProperty('needs');
    const wait = findStep(sonar, 'Wait for successful coverage');
    expect(wait).toEqual({
      name: 'Wait for successful coverage',
      env: {
        GH_TOKEN: '${{ github.token }}',
        EXPECTED_HEAD_SHA: '${{ github.event.pull_request.head.sha || github.sha }}',
      },
      run: 'node scripts/wait-for-coverage.mjs',
    });
    expect(COVERAGE_JOBS).toEqual([
      build.jobs['unit-coverage'].name,
      ...rendererCoverage.strategy.matrix['shard-index'].map((index) =>
        rendererCoverage.name
          .replace('${{ matrix.shard-index }}', index)
          .replace('${{ matrix.shard-total }}', rendererCoverage.strategy.matrix['shard-total'][0]),
      ),
    ]);
    for (const name of ['Install dependencies', 'Install verified SonarScanner CLI']) {
      expect(sonar.steps.indexOf(findStep(sonar, name))).toBeLessThan(sonar.steps.indexOf(wait));
    }
    for (const name of [
      'Download unit coverage',
      'Download renderer coverage shards',
      'Run Sonar finding gate',
    ]) {
      expect(sonar.steps.indexOf(findStep(sonar, name))).toBeGreaterThan(sonar.steps.indexOf(wait));
    }
    const merge = findStep(sonar, 'Merge renderer coverage');
    expect(merge).not.toHaveProperty('if');
    expect(merge.run).toContain('--merge-reports');
    expect(merge.run).toContain('--coverage.reporter=lcov');
    expect(merge.run).toContain('--coverage.reportsDirectory=coverage/renderer');
  });

  it('grants read authority only to the jobs that need it', async () => {
    const build = await readYaml('.github/workflows/build.yml');

    expect(build.permissions).toEqual({ contents: 'read' });
    expect(build.jobs.sonarqube.permissions).toEqual({
      actions: 'read',
      contents: 'read',
    });
    for (const jobName of ['unit-coverage', 'renderer-coverage', 'windows-unit', 'snyk']) {
      expect(build.jobs[jobName]).not.toHaveProperty('permissions');
    }
  });

  it('analyzes fresh coverage from the exact commit on every Sonar run', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const sonar = build.jobs.sonarqube;

    expect(findStep(sonar, 'Checkout exact commit').with).toEqual({
      'fetch-depth': 0,
      ref: '${{ github.sha }}',
    });
    for (const name of [
      'Wait for successful coverage',
      'Download unit coverage',
      'Download renderer coverage shards',
      'Merge renderer coverage',
      'Validate merged LCOV',
      'Run Sonar finding gate',
    ]) {
      expect(findStep(sonar, name), name).toBeDefined();
      expect(findStep(sonar, name), name).not.toHaveProperty('if');
    }
    expect(findStep(sonar, 'Validate merged LCOV').run).toContain(
      'test -s coverage/unit/lcov.info',
    );
    expect(findStep(sonar, 'Validate merged LCOV').run).toContain(
      'test -s coverage/renderer/lcov.info',
    );
    expect(findStep(sonar, 'Run Sonar finding gate').run).toContain('npm run security:sonar:ci --');
  });

  it('rejects altered scanner downloads before extraction and removes npm scanner exceptions', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const install = findStep(build.jobs.sonarqube, 'Install verified SonarScanner CLI');
    const root = await mkdtemp(join(tmpdir(), 'relay-scanner-check-'));
    try {
      const bin = join(root, 'bin');
      await mkdir(bin);
      await writeFile(
        join(bin, 'curl'),
        '#!/bin/sh\nwhile [ "$1" != "--output" ]; do shift; done\nprintf corrupted > "$2"\n',
        { mode: 0o700 },
      );
      await writeFile(join(bin, 'unzip'), '#!/bin/sh\necho "unzip ran"\n', { mode: 0o700 });
      const result = runWorkflowBash(['-eo', 'pipefail', '-c', install.run], {
        encoding: 'utf8',
        env: { ...withPathPrepended(process.env, bin), RUNNER_TEMP: root },
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('FAILED');
      expect(result.stdout).not.toContain('unzip ran');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    const manifest = await readJson('package.json');
    const lock = await readJson('package-lock.json');
    expect(manifest.scripts['security:sonar']).toBe('sonar-scanner');
    expect(lock.packages['node_modules/@sonar/scan']).toBeUndefined();
    expect(lock.packages['node_modules/node-forge']).toBeUndefined();
    expect(JSON.stringify((await readYaml('.snyk')).ignore)).not.toMatch(
      /@sonar\/scan|node-forge/u,
    );
  });

  it('runs the required Snyk check as one scanning job', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const gate = build.jobs.snyk;

    expect(build.jobs).not.toHaveProperty('snyk-scan');
    expect(gate.name).toBe('Snyk security gate');
    expect(gate).not.toHaveProperty('needs');
    expect(normalizeExpression(gate.if)).toContain(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(findStep(gate, 'Run Snyk finding gate')).toEqual({
      name: 'Run Snyk finding gate',
      env: {
        SNYK_ORG: '${{ vars.SNYK_ORG }}',
        SNYK_TOKEN: '${{ secrets.SNYK_TOKEN }}',
      },
      run: 'npm run security:snyk:ci',
    });
  });

  it('caches Sonar packages independently of scanner credentials', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const cache = findStep(build.jobs.sonarqube, 'Cache Sonar packages');

    expect(cache).toEqual({
      name: 'Cache Sonar packages',
      'continue-on-error': true,
      uses: 'actions/cache@caa296126883cff596d87d8935842f9db880ef25',
      with: {
        path: '~/.sonar/cache',
        key: "sonar-${{ runner.os }}-${{ hashFiles('package-lock.json') }}",
        'restore-keys': 'sonar-${{ runner.os }}-',
      },
    });
  });

  it('keeps Claude worktrees out of lint and formatting', async () => {
    const [eslintConfig, prettierIgnore] = await Promise.all([
      readProjectFile('eslint.config.js'),
      readProjectFile('.prettierignore'),
    ]);

    expect(eslintConfig).toContain("'.claude/worktrees/**'");
    expect(prettierIgnore.split(/\r?\n/u)).toContain('.claude/worktrees');
  });

  it('excludes generated audio and vendored coverage from Sonar analysis', async () => {
    const [sonar, unitConfigText] = await Promise.all([
      readProjectFile('sonar-project.properties'),
      readProjectFile('vitest.config.ts'),
    ]);

    expect(sonar).toContain('sonar.exclusions=');
    expect(sonar).toContain('src/renderer/public/audio/**');
    expect(sonar).toContain(
      'sonar.javascript.lcov.reportPaths=coverage/unit/lcov.info,coverage/renderer/lcov.info',
    );
    expect(unitConfigText).toContain("'vendor/**'");
  });
});
