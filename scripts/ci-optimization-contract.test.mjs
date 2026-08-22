import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import unitConfig from '../vitest.config.ts';
import cacheConfig from '../vitest.cache.config.ts';
import rendererConfig from '../vitest.renderer.config.ts';
import verificationConfig from '../vitest.verify.config.ts';

const projectRoot = new URL('../', import.meta.url);
const readProjectFile = async (path) => readFile(new URL(path, projectRoot), 'utf8');
const readJson = async (path) => JSON.parse(await readProjectFile(path));
const readYaml = async (path) => parse(await readProjectFile(path));
const findStep = (job, name) => job.steps.find((step) => step.name === name);
const normalizeExpression = (value) => String(value).replaceAll(/\s+/gu, ' ').trim();

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
    expect(pkg.scripts.lint).toContain('--cache --cache-location .cache/eslint');
    expect(pkg.scripts.lint).toContain('--cache-strategy content');
    expect(pkg.scripts['format:check']).toContain('--cache --cache-location .cache/prettier');
    expect(pkg.scripts['format:check']).toContain('--cache-strategy content');
  });

  it('never restores ESLint across commits while allowing safe Prettier content-cache reuse', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const eslintCache = findStep(build.jobs.static, 'Cache ESLint results');
    const prettierCache = findStep(build.jobs.static, 'Cache Prettier results');

    expect(eslintCache).toEqual({
      name: 'Cache ESLint results',
      'continue-on-error': true,
      uses: 'actions/cache@v5',
      with: {
        path: '.cache/eslint',
        key: "eslint-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', 'eslint.config.js', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.renderer.json') }}-${{ github.sha }}",
      },
    });
    expect(eslintCache.with).not.toHaveProperty('restore-keys');

    expect(prettierCache).toEqual({
      name: 'Cache Prettier results',
      'continue-on-error': true,
      uses: 'actions/cache@v5',
      with: {
        path: '.cache/prettier',
        key: "prettier-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', '.prettierrc', '.prettierignore') }}-${{ github.sha }}",
        'restore-keys':
          "prettier-${{ runner.os }}-node-${{ hashFiles('.node-version') }}-${{ hashFiles('package-lock.json', '.prettierrc', '.prettierignore') }}-",
      },
    });
  });

  it('shards renderer tests behind a fail-closed aggregate build gate', async () => {
    const build = await readYaml('.github/workflows/build.yml');

    for (const jobName of ['static', 'unit-tests', 'renderer-tests']) {
      expect(build.jobs[jobName].needs).toBe('provenance');
      expect(build.jobs[jobName].if).toBe("needs.provenance.outputs.reuse != 'true'");
    }
    expect(build.jobs['renderer-tests'].strategy).toEqual({
      'fail-fast': false,
      matrix: {
        'shard-index': [1, 2],
        'shard-total': [2],
      },
    });
    expect(findStep(build.jobs['renderer-tests'], 'Run renderer tests').run).toBe(
      'npm run test:renderer -- --shard=${{ matrix.shard-index }}/${{ matrix.shard-total }}',
    );
    expect(findStep(build.jobs['unit-tests'], 'Run unit tests').run).toBe(
      'npm run test:unit && npm run test:cache',
    );

    const quality = build.jobs.quality;
    expect(quality.name).toBe('Build quality gate');
    expect(quality.if).toBe('always()');
    expect(quality.needs).toEqual(['provenance', 'static', 'unit-tests', 'renderer-tests']);
    const aggregate = findStep(quality, 'Require successful build components');
    expect(aggregate.env).toEqual({
      ELIGIBLE: '${{ needs.provenance.outputs.eligible }}',
      PROVENANCE_RESULT: '${{ needs.provenance.result }}',
      RENDERER_TESTS_RESULT: '${{ needs.renderer-tests.result }}',
      REUSE: '${{ needs.provenance.outputs.reuse }}',
      STATIC_RESULT: '${{ needs.static.result }}',
      UNIT_TESTS_RESULT: '${{ needs.unit-tests.result }}',
    });
    expect(aggregate.run).toContain('[[ "$PROVENANCE_RESULT" != "success" ]]');
    expect(aggregate.run).toContain('[[ "$REUSE" == "true" ]]');
    expect(aggregate.run).toContain('[[ "$ELIGIBLE" == "true" ]]');
    expect(aggregate.run.replaceAll(/\s+/gu, ' ')).toContain(
      'if [[ "$STATIC_RESULT" != "success" || "$UNIT_TESTS_RESULT" != "success" || "$RENDERER_TESTS_RESULT" != "success" ]]; then',
    );
    expect(aggregate.run).toContain('exit 1');
  });

  it('merges both renderer coverage shards before the Sonar scan', async () => {
    const security = await readYaml('.github/workflows/security.yml');
    const rendererCoverage = security.jobs['renderer-coverage'];

    expect(rendererCoverage.strategy).toEqual({
      'fail-fast': false,
      matrix: {
        'shard-index': [1, 2],
        'shard-total': [2],
      },
    });
    const rendererCommand = findStep(rendererCoverage, 'Generate renderer coverage shard').run;
    expect(rendererCommand).toContain('--reporter=dot');
    expect(rendererCommand).toContain('--reporter=blob');
    expect(rendererCommand).toContain(
      '--shard=${{ matrix.shard-index }}/${{ matrix.shard-total }}',
    );

    const sonar = security.jobs.sonarqube;
    expect(sonar.name).toBe('SonarQube quality gate');
    expect(sonar.needs).toEqual(['provenance', 'unit-coverage', 'renderer-coverage']);
    const merge = findStep(sonar, 'Merge renderer coverage');
    expect(merge.if).toBe("needs.provenance.outputs.reuse != 'true'");
    expect(merge.run).toContain('--merge-reports');
    expect(merge.run).toContain('--coverage.reporter=lcov');
    expect(merge.run).toContain('--coverage.reportsDirectory=coverage/renderer');
  });

  it('resolves exact-tree provenance in both workflows with least read authority', async () => {
    const [build, security] = await Promise.all([
      readYaml('.github/workflows/build.yml'),
      readYaml('.github/workflows/security.yml'),
    ]);

    for (const workflow of [build, security]) {
      expect(workflow.permissions).toEqual({ contents: 'read' });
      const provenance = workflow.jobs.provenance;
      expect(provenance.permissions).toEqual({
        actions: 'read',
        checks: 'read',
        contents: 'read',
        'pull-requests': 'read',
      });
      expect(provenance.outputs).toEqual({
        'coverage-artifact': '${{ steps.metadata.outputs.coverage-artifact }}',
        eligible: '${{ steps.finalize.outputs.eligible }}',
        'head-sha': '${{ steps.metadata.outputs.head-sha }}',
        'head-tree': '${{ steps.metadata.outputs.head-tree }}',
        'pull-request': '${{ steps.metadata.outputs.pull-request }}',
        reason: '${{ steps.finalize.outputs.reason }}',
        reuse: '${{ steps.finalize.outputs.reuse }}',
        'security-run-id': '${{ steps.metadata.outputs.security-run-id }}',
      });
      const metadata = findStep(provenance, 'Resolve exact-tree reuse metadata');
      expect(metadata.id).toBe('metadata');
      expect(metadata.env).toEqual({ GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' });
      expect(metadata.run).toBe('node scripts/ciTreeReuse.mjs');

      const buildPayload = findStep(provenance, 'Download candidate Build attestation');
      expect(buildPayload).toEqual({
        name: 'Download candidate Build attestation',
        id: 'build_payload',
        if: "steps.metadata.outputs.metadata-eligible == 'true'",
        'continue-on-error': true,
        uses: 'actions/download-artifact@v8',
        with: {
          'github-token': '${{ secrets.GITHUB_TOKEN }}',
          name: '${{ steps.metadata.outputs.build-artifact }}',
          path: '${{ runner.temp }}/ci-reuse/build',
          'run-id': '${{ steps.metadata.outputs.build-run-id }}',
        },
      });
      const coveragePayload = findStep(provenance, 'Download candidate merged LCOV');
      expect(coveragePayload).toEqual({
        name: 'Download candidate merged LCOV',
        id: 'coverage_payload',
        if: "steps.metadata.outputs.metadata-eligible == 'true'",
        'continue-on-error': true,
        uses: 'actions/download-artifact@v8',
        with: {
          'github-token': '${{ secrets.GITHUB_TOKEN }}',
          name: '${{ steps.metadata.outputs.coverage-artifact }}',
          path: '${{ runner.temp }}/ci-reuse/coverage',
          'run-id': '${{ steps.metadata.outputs.security-run-id }}',
        },
      });

      const finalize = findStep(provenance, 'Finalize exact-tree reuse');
      expect(finalize.id).toBe('finalize');
      expect(finalize.if).toBe('always()');
      expect(finalize.env).toEqual({
        BASE_SHA: '${{ steps.metadata.outputs.base-sha }}',
        BUILD_ARTIFACT_DIRECTORY: '${{ runner.temp }}/ci-reuse/build',
        BUILD_DOWNLOAD_OUTCOME: '${{ steps.build_payload.outcome }}',
        COVERAGE_ARTIFACT_DIRECTORY: '${{ runner.temp }}/ci-reuse/coverage',
        COVERAGE_DOWNLOAD_OUTCOME: '${{ steps.coverage_payload.outcome }}',
        HEAD_SHA: '${{ steps.metadata.outputs.head-sha }}',
        METADATA_ELIGIBLE: '${{ steps.metadata.outputs.metadata-eligible }}',
        METADATA_REASON: '${{ steps.metadata.outputs.metadata-reason }}',
        PULL_REQUEST: '${{ steps.metadata.outputs.pull-request }}',
        RELAY_CI_TREE_REUSE_MODE: '${{ vars.RELAY_CI_TREE_REUSE_MODE }}',
      });
      expect(finalize.run).toBe('node scripts/ciReuseArtifactValidation.mjs');
      expect(provenance.steps.indexOf(finalize)).toBeGreaterThan(
        provenance.steps.indexOf(coveragePayload),
      );
    }

    expect(security.jobs.sonarqube.permissions).toEqual({
      actions: 'read',
      contents: 'read',
    });
    for (const jobName of ['unit-coverage', 'renderer-coverage', 'snyk-scan', 'snyk']) {
      expect(security.jobs[jobName]).not.toHaveProperty('permissions');
    }
  });

  it('stores a nonempty exact PR/base/head attestation only after a successful Build gate', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const quality = build.jobs.quality;
    const write = findStep(quality, 'Write PR provenance attestation');
    const upload = findStep(quality, 'Upload PR provenance attestation');

    expect(write.if).toBe("github.event_name == 'pull_request'");
    expect(write.env).toEqual({
      BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      PR_NUMBER: '${{ github.event.pull_request.number }}',
    });
    expect(write.run).toContain('printf');
    expect(write.run).toContain('$RUNNER_TEMP/relay-pr-provenance.txt');
    expect(upload).toEqual({
      name: 'Upload PR provenance attestation',
      if: "github.event_name == 'pull_request'",
      uses: 'actions/upload-artifact@v7',
      with: {
        name: 'relay-pr-provenance-${{ github.event.pull_request.number }}-${{ github.event.pull_request.base.sha }}-${{ github.event.pull_request.head.sha }}',
        path: '${{ runner.temp }}/relay-pr-provenance.txt',
        'if-no-files-found': 'error',
        'retention-days': 1,
      },
    });
    expect(quality.steps.indexOf(write)).toBeGreaterThan(
      quality.steps.indexOf(findStep(quality, 'Require successful build components')),
    );
    expect(quality.steps.indexOf(upload)).toBeGreaterThan(quality.steps.indexOf(write));
  });

  it('keeps shadow mode on the full security path and reuses only exact validated outputs', async () => {
    const security = await readYaml('.github/workflows/security.yml');
    const unit = security.jobs['unit-coverage'];
    const renderer = security.jobs['renderer-coverage'];

    for (const coverage of [unit, renderer]) {
      expect(coverage.needs).toBe('provenance');
      expect(normalizeExpression(coverage.if)).toContain(
        "needs.provenance.outputs.reuse != 'true'",
      );
    }

    const sonar = security.jobs.sonarqube;
    const preflight = findStep(sonar, 'Require valid provenance or successful coverage');
    expect(sonar.if).toContain('always()');
    expect(preflight.env).toEqual({
      ELIGIBLE: '${{ needs.provenance.outputs.eligible }}',
      PROVENANCE_RESULT: '${{ needs.provenance.result }}',
      RENDERER_COVERAGE_RESULT: '${{ needs.renderer-coverage.result }}',
      REUSE: '${{ needs.provenance.outputs.reuse }}',
      UNIT_COVERAGE_RESULT: '${{ needs.unit-coverage.result }}',
    });
    expect(preflight.run).toContain('[[ "$PROVENANCE_RESULT" != "success" ]]');
    expect(preflight.run).toContain('[[ "$REUSE" == "true" ]]');
    expect(preflight.run).toContain('[[ "$ELIGIBLE" == "true" ]]');
    expect(preflight.run).toContain('[[ "$UNIT_COVERAGE_RESULT" != "success"');

    expect(findStep(sonar, 'Checkout exact commit').with).toEqual({
      'fetch-depth': 0,
      ref: '${{ github.sha }}',
    });
    expect(findStep(sonar, 'Download validated PR LCOV')).toMatchObject({
      if: "needs.provenance.outputs.reuse == 'true'",
      uses: 'actions/download-artifact@v8',
      with: {
        'github-token': '${{ secrets.GITHUB_TOKEN }}',
        name: '${{ needs.provenance.outputs.coverage-artifact }}',
        path: 'coverage',
        'run-id': '${{ needs.provenance.outputs.security-run-id }}',
      },
    });
    expect(findStep(sonar, 'Download unit coverage').if).toBe(
      "needs.provenance.outputs.reuse != 'true'",
    );
    expect(findStep(sonar, 'Download renderer coverage shards').if).toBe(
      "needs.provenance.outputs.reuse != 'true'",
    );
    expect(findStep(sonar, 'Validate merged LCOV').run).toContain(
      'test -s coverage/unit/lcov.info',
    );
    expect(findStep(sonar, 'Validate merged LCOV').run).toContain(
      'test -s coverage/renderer/lcov.info',
    );
    expect(findStep(sonar, 'Upload merged LCOV')).toEqual({
      name: 'Upload merged LCOV',
      if: "needs.provenance.outputs.reuse != 'true' && github.event_name == 'pull_request'",
      uses: 'actions/upload-artifact@v7',
      with: {
        name: 'relay-merged-lcov-${{ github.event.pull_request.number }}-${{ github.event.pull_request.base.sha }}-${{ github.event.pull_request.head.sha }}',
        path: 'coverage/unit/lcov.info\ncoverage/renderer/lcov.info\n',
        'if-no-files-found': 'error',
        'retention-days': 1,
      },
    });
    expect(findStep(sonar, 'Run Sonar finding gate').run).toContain('npm run security:sonar:ci --');
  });

  it('keeps the required Snyk check materialized behind a fail-closed aggregator', async () => {
    const security = await readYaml('.github/workflows/security.yml');
    const scan = security.jobs['snyk-scan'];
    const gate = security.jobs.snyk;

    expect(scan.needs).toBe('provenance');
    expect(normalizeExpression(scan.if)).toContain("needs.provenance.outputs.reuse != 'true'");
    expect(findStep(scan, 'Run Snyk finding gate').run).toBe('npm run security:snyk:ci');
    expect(gate.name).toBe('Snyk security gate');
    expect(gate.if).toContain('always()');
    expect(gate.needs).toEqual(['provenance', 'snyk-scan']);
    const aggregate = findStep(gate, 'Require valid provenance or successful Snyk scan');
    expect(aggregate.env).toEqual({
      ELIGIBLE: '${{ needs.provenance.outputs.eligible }}',
      PROVENANCE_RESULT: '${{ needs.provenance.result }}',
      REUSE: '${{ needs.provenance.outputs.reuse }}',
      SNYK_SCAN_RESULT: '${{ needs.snyk-scan.result }}',
    });
    expect(aggregate.run).toContain('[[ "$PROVENANCE_RESULT" != "success" ]]');
    expect(aggregate.run).toContain('[[ "$REUSE" == "true" ]]');
    expect(aggregate.run).toContain('[[ "$ELIGIBLE" == "true" ]]');
    expect(aggregate.run).toContain('[[ "$SNYK_SCAN_RESULT" != "success" ]]');
  });

  it('caches Sonar packages independently of scanner credentials', async () => {
    const security = await readYaml('.github/workflows/security.yml');
    const cache = findStep(security.jobs.sonarqube, 'Cache Sonar packages');

    expect(cache).toEqual({
      name: 'Cache Sonar packages',
      'continue-on-error': true,
      uses: 'actions/cache@v5',
      with: {
        path: '~/.sonar/cache',
        key: "sonar-${{ runner.os }}-${{ hashFiles('package-lock.json') }}",
      },
    });
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

  it('keeps GitHub response IDs visibly sanitized and CLI entrypoints on top-level await', async () => {
    const [treeReuse, artifactValidation] = await Promise.all([
      readProjectFile('scripts/ciTreeReuse.mjs'),
      readProjectFile('scripts/ciReuseArtifactValidation.mjs'),
    ]);

    expect(treeReuse).toContain('const pullRequestNumber = pullRequests[0]?.number;');
    expect(treeReuse).toContain('!Number.isSafeInteger(pullRequestNumber)');
    expect(treeReuse).not.toContain('${pullRequests[0].number}');
    expect(treeReuse).toContain('await runCiTreeReuse();');
    expect(treeReuse).not.toContain('runCiTreeReuse().catch(');
    expect(artifactValidation).toContain('await runCiReuseArtifactValidation();');
    expect(artifactValidation).not.toContain('runCiReuseArtifactValidation().catch(');
  });
});
