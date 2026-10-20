import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const buildWorkflow = await readFile(
  new URL('../.github/workflows/build.yml', import.meta.url),
  'utf8',
);
const build = parse(buildWorkflow);
const normalizeExpression = (value) => value.replaceAll(/\s+/gu, ' ').trim();
const findStep = (job, name) => {
  assert.ok(job?.steps, `missing workflow job for step: ${name}`);
  const step = job.steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
};

test('main pull requests emit the stable build quality gate', () => {
  assert.deepEqual(build.on.push.branches, ['main']);
  assert.deepEqual(build.on.pull_request.branches, ['main']);
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.equal(build.jobs.quality.name, 'Build quality gate');
  assert.equal(build.jobs.quality.if, 'always()');
  assert.deepEqual(build.jobs.quality.needs, [
    'static',
    'unit-coverage',
    'renderer-coverage',
    'windows-unit',
    'workflow-tests',
    'windows-package-scope',
    'package-windows',
  ]);
  const aggregate = findStep(build.jobs.quality, 'Require successful build components');
  assert.deepEqual(aggregate.env, {
    RENDERER_COVERAGE_RESULT: '${{ needs.renderer-coverage.result }}',
    STATIC_RESULT: '${{ needs.static.result }}',
    UNIT_COVERAGE_RESULT: '${{ needs.unit-coverage.result }}',
    WINDOWS_PACKAGE_REQUIRED: '${{ needs.windows-package-scope.outputs.required }}',
    WINDOWS_PACKAGE_RESULT: '${{ needs.package-windows.result }}',
    WINDOWS_PACKAGE_SCOPE_RESULT: '${{ needs.windows-package-scope.result }}',
    WINDOWS_UNIT_RESULT: '${{ needs.windows-unit.result }}',
    WORKFLOW_TESTS_RESULT: '${{ needs.workflow-tests.result }}',
  });
  assert.match(aggregate.run, /exit 1/u);
  assert.equal(build.jobs['package-windows'].needs, 'windows-package-scope');
});

test('Sonar consumes unit coverage and all four merged renderer coverage shards', () => {
  const unitCoverage = build.jobs['unit-coverage'];
  const rendererCoverage = build.jobs['renderer-coverage'];
  const sonar = build.jobs.sonarqube;

  assert.equal(
    findStep(unitCoverage, 'Generate unit coverage').run,
    'npm run test:coverage -- --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0',
  );
  assert.deepEqual(findStep(unitCoverage, 'Upload unit coverage'), {
    name: 'Upload unit coverage',
    uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    with: {
      name: 'unit-coverage',
      path: 'coverage/unit/lcov.info',
      'if-no-files-found': 'error',
      'retention-days': 1,
    },
  });
  assert.deepEqual(rendererCoverage.strategy.matrix, {
    'shard-index': [1, 2, 3, 4],
    'shard-total': [4],
  });
  assert.equal(rendererCoverage.strategy['fail-fast'], false);
  assert.equal(
    findStep(rendererCoverage, 'Generate renderer coverage shard').run,
    'npm run test:renderer -- --coverage --reporter=dot --reporter=blob --shard=${{ matrix.shard-index }}/${{ matrix.shard-total }} --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 --coverage.thresholds.branches=0 --coverage.thresholds.statements=0',
  );
  assert.deepEqual(findStep(rendererCoverage, 'Upload renderer coverage shard'), {
    name: 'Upload renderer coverage shard',
    uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    with: {
      name: 'renderer-coverage-${{ matrix.shard-index }}',
      path: '.vitest/blob/',
      'if-no-files-found': 'error',
      'include-hidden-files': true,
      'retention-days': 1,
    },
  });
  assert.ok(!('needs' in sonar), 'Sonar waits for coverage jobs by polling, not needs');
  assert.deepEqual(findStep(sonar, 'Download unit coverage').with, {
    name: 'unit-coverage',
    path: 'coverage/unit',
  });
  assert.deepEqual(findStep(sonar, 'Download renderer coverage shards').with, {
    pattern: 'renderer-coverage-*',
    path: '.vitest/blob',
    'merge-multiple': true,
  });
  const merge = findStep(sonar, 'Merge renderer coverage');
  assert.ok(!('if' in merge), 'renderer coverage is always merged');
  assert.match(merge.run, /--merge-reports/u);
  assert.match(merge.run, /--config vitest\.renderer\.config\.ts/u);
  assert.match(merge.run, /--coverage\.reporter=lcov/u);
  assert.match(merge.run, /--coverage\.reportsDirectory=coverage\/renderer/u);
  assert.ok(!sonar.steps.some((step) => step.name === 'Upload merged LCOV'));
});

test('Sonar runs on the exact commit and fails closed without fresh coverage', () => {
  const sonar = build.jobs.sonarqube;

  assert.equal(
    normalizeExpression(sonar.if),
    normalizeExpression(`
      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'pull_request' &&
       github.event.pull_request.base.ref == 'main' &&
       github.event.pull_request.head.repo.full_name == github.repository)
    `),
  );

  const wait = findStep(sonar, 'Wait for successful coverage');
  assert.ok(!('if' in wait), 'Sonar always waits for fresh coverage');
  assert.equal(wait.run, 'node scripts/wait-for-coverage.mjs');
  assert.notEqual(wait['continue-on-error'], true);
  for (const name of [
    'Download unit coverage',
    'Download renderer coverage shards',
    'Run Sonar finding gate',
  ]) {
    assert.ok(sonar.steps.indexOf(wait) < sonar.steps.indexOf(findStep(sonar, name)));
  }
  assert.match(findStep(sonar, 'Validate merged LCOV').run, /test -s coverage\/unit\/lcov\.info/u);
  assert.match(
    findStep(sonar, 'Validate merged LCOV').run,
    /test -s coverage\/renderer\/lcov\.info/u,
  );
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
  assert.equal(build.jobs.sonarqube.name, 'SonarQube quality gate');
  assert.equal(build.jobs.snyk.name, 'Snyk security gate');
  assert.equal(build.jobs.sonarqube['timeout-minutes'], 25);
  assert.equal(build.jobs.snyk['timeout-minutes'], 25);
  assert.deepEqual(build.permissions, { contents: 'read' });
  assert.deepEqual(build.jobs.sonarqube.permissions, {
    actions: 'read',
    contents: 'read',
  });
  assert.match(findStep(build.jobs.sonarqube, 'Run Sonar finding gate').run, /security:sonar:ci/u);
  assert.match(findStep(build.jobs.snyk, 'Run Snyk finding gate').run, /security:snyk:ci/u);
});

test('Snyk delegates internal main pull requests and merged pushes to its CI gate', () => {
  const snyk = build.jobs.snyk;
  assert.ok(!('snyk-scan' in build.jobs), 'the required Snyk check is the scanning job itself');
  assert.equal(snyk.name, 'Snyk security gate');
  assert.ok(!('needs' in snyk));
  assert.equal(
    normalizeExpression(snyk.if),
    normalizeExpression(`
      (github.event_name == 'push' && github.ref == 'refs/heads/main') ||
      (github.event_name == 'pull_request' &&
       github.event.pull_request.base.ref == 'main' &&
       github.event.pull_request.head.repo.full_name == github.repository)
    `),
  );

  const scanStep = findStep(snyk, 'Run Snyk finding gate');
  assert.ok(!('if' in scanStep));
  assert.equal(scanStep.run, 'npm run security:snyk:ci');
});
