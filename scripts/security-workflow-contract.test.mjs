import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const [buildWorkflow, securityWorkflow] = await Promise.all([
  readFile(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/security.yml', import.meta.url), 'utf8'),
]);

const build = parse(buildWorkflow);
const security = parse(securityWorkflow);
const normalizeExpression = (value) => value.replaceAll(/\s+/gu, ' ').trim();
const findStep = (job, name) => {
  assert.ok(job?.steps, `missing workflow job for step: ${name}`);
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
};

test('test pull requests emit the stable build quality gate', () => {
  assert.deepEqual(build.on.pull_request.branches, ['main', 'test']);
  assert.equal(build.jobs.quality.name, 'Build quality gate');
  assert.equal(build.jobs.quality.if, 'always()');
  assert.deepEqual(build.jobs.quality.needs, [
    'provenance',
    'static',
    'unit-tests',
    'renderer-tests',
  ]);
  const aggregate = findStep(build.jobs.quality, 'Require successful build components');
  assert.deepEqual(aggregate.env, {
    ELIGIBLE: '${{ needs.provenance.outputs.eligible }}',
    PROVENANCE_RESULT: '${{ needs.provenance.result }}',
    RENDERER_TESTS_RESULT: '${{ needs.renderer-tests.result }}',
    REUSE: '${{ needs.provenance.outputs.reuse }}',
    STATIC_RESULT: '${{ needs.static.result }}',
    UNIT_TESTS_RESULT: '${{ needs.unit-tests.result }}',
  });
  assert.match(aggregate.run, /exit 1/u);
  assert.ok(
    !('needs' in build.jobs['package-windows']),
    'package-windows must not declare a needs dependency',
  );
});

test('Sonar consumes unit coverage and both merged renderer coverage shards', () => {
  const unitCoverage = security.jobs['unit-coverage'];
  const rendererCoverage = security.jobs['renderer-coverage'];
  const sonar = security.jobs.sonarqube;

  assert.equal(
    findStep(unitCoverage, 'Generate unit coverage').run,
    'npm run test:coverage -- --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0',
  );
  assert.deepEqual(findStep(unitCoverage, 'Upload unit coverage'), {
    name: 'Upload unit coverage',
    uses: 'actions/upload-artifact@v7',
    with: {
      name: 'unit-coverage',
      path: 'coverage/unit/lcov.info',
      'if-no-files-found': 'error',
      'retention-days': 1,
    },
  });
  assert.deepEqual(rendererCoverage.strategy.matrix, {
    'shard-index': [1, 2],
    'shard-total': [2],
  });
  assert.equal(rendererCoverage.strategy['fail-fast'], false);
  assert.equal(
    findStep(rendererCoverage, 'Generate renderer coverage shard').run,
    'npm run test:renderer -- --coverage --reporter=blob --shard=${{ matrix.shard-index }}/${{ matrix.shard-total }} --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0',
  );
  assert.deepEqual(findStep(rendererCoverage, 'Upload renderer coverage shard'), {
    name: 'Upload renderer coverage shard',
    uses: 'actions/upload-artifact@v7',
    with: {
      name: 'renderer-coverage-${{ matrix.shard-index }}',
      path: '.vitest-reports/',
      'if-no-files-found': 'error',
      'include-hidden-files': true,
      'retention-days': 1,
    },
  });
  assert.deepEqual(sonar.needs, ['provenance', 'unit-coverage', 'renderer-coverage']);
  assert.deepEqual(findStep(sonar, 'Download unit coverage').with, {
    name: 'unit-coverage',
    path: 'coverage/unit',
  });
  assert.deepEqual(findStep(sonar, 'Download renderer coverage shards').with, {
    pattern: 'renderer-coverage-*',
    path: '.vitest-reports',
    'merge-multiple': true,
  });
  const merge = findStep(sonar, 'Merge renderer coverage');
  assert.equal(merge.if, "needs.provenance.outputs.reuse != 'true'");
  assert.match(merge.run, /--merge-reports/u);
  assert.match(merge.run, /--config vitest\.renderer\.config\.ts/u);
  assert.match(merge.run, /--coverage\.reporter=lcov/u);
  assert.match(merge.run, /--coverage\.reportsDirectory=coverage\/renderer/u);
});

test('Sonar runs on the exact commit and fails closed without valid reuse or fresh coverage', () => {
  const sonar = security.jobs.sonarqube;

  assert.equal(
    normalizeExpression(sonar.if),
    normalizeExpression(`
      always() && (
        (github.event_name == 'push' && github.ref == 'refs/heads/test') ||
        (github.event_name == 'pull_request' &&
         github.event.pull_request.base.ref == 'test' &&
         github.event.pull_request.head.repo.full_name == github.repository)
      )
    `),
  );

  const coverageGate = findStep(sonar, 'Require valid provenance or successful coverage');
  assert.equal(sonar.steps.indexOf(coverageGate), 0);
  assert.deepEqual(coverageGate.env, {
    ELIGIBLE: '${{ needs.provenance.outputs.eligible }}',
    PROVENANCE_RESULT: '${{ needs.provenance.result }}',
    RENDERER_COVERAGE_RESULT: '${{ needs.renderer-coverage.result }}',
    REUSE: '${{ needs.provenance.outputs.reuse }}',
    UNIT_COVERAGE_RESULT: '${{ needs.unit-coverage.result }}',
  });
  assert.match(coverageGate.run, /\$PROVENANCE_RESULT.*success/u);
  assert.match(coverageGate.run, /\$REUSE.*true/u);
  assert.match(coverageGate.run, /\$ELIGIBLE.*true/u);
  assert.match(
    normalizeExpression(coverageGate.run),
    /if \[\[ "\$UNIT_COVERAGE_RESULT" != "success" \|\| "\$RENDERER_COVERAGE_RESULT" != "success" \]\]; then/u,
  );
  assert.match(coverageGate.run, /exit 1/u);
  assert.deepEqual(findStep(sonar, 'Checkout exact commit').with, {
    'fetch-depth': 0,
    ref: '${{ github.sha }}',
  });
  assert.equal(
    findStep(sonar, 'Verify exact checked-out commit').run,
    'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
  );
});

test('scanner jobs retain stable required names and bounded CI entrypoints', () => {
  assert.equal(security.jobs.sonarqube.name, 'SonarQube quality gate');
  assert.equal(security.jobs.snyk.name, 'Snyk security gate');
  assert.equal(security.jobs.sonarqube['timeout-minutes'], 25);
  assert.equal(security.jobs['snyk-scan']['timeout-minutes'], 25);
  assert.match(
    findStep(security.jobs.sonarqube, 'Run Sonar finding gate').run,
    /security:sonar:ci/u,
  );
  assert.match(
    findStep(security.jobs['snyk-scan'], 'Run Snyk finding gate').run,
    /security:snyk:ci/u,
  );
});

test('Snyk delegates internal test pull requests and merged pushes to its CI gate', () => {
  const snyk = security.jobs['snyk-scan'];
  assert.equal(snyk.needs, 'provenance');
  assert.equal(
    normalizeExpression(snyk.if),
    normalizeExpression(`
      needs.provenance.outputs.reuse != 'true' && (
        (github.event_name == 'push' && github.ref == 'refs/heads/test') ||
        (github.event_name == 'pull_request' &&
         github.event.pull_request.base.ref == 'test' &&
         github.event.pull_request.head.repo.full_name == github.repository)
      )
    `),
  );

  const scanStep = findStep(snyk, 'Run Snyk finding gate');
  assert.equal(scanStep.run, 'npm run security:snyk:ci');

  const gate = security.jobs.snyk;
  assert.equal(gate.name, 'Snyk security gate');
  assert.deepEqual(gate.needs, ['provenance', 'snyk-scan']);
  assert.match(normalizeExpression(gate.if), /^always\(\) &&/u);
  const aggregate = findStep(gate, 'Require valid provenance or successful Snyk scan');
  assert.deepEqual(aggregate.env, {
    ELIGIBLE: '${{ needs.provenance.outputs.eligible }}',
    PROVENANCE_RESULT: '${{ needs.provenance.result }}',
    REUSE: '${{ needs.provenance.outputs.reuse }}',
    SNYK_SCAN_RESULT: '${{ needs.snyk-scan.result }}',
  });
  assert.match(aggregate.run, /exit 1/u);
});
