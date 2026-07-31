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

test('test pull requests emit the stable build quality gate', () => {
  assert.deepEqual(build.on.pull_request.branches, ['main', 'test']);
  assert.equal(build.jobs.quality.name, 'Build quality gate');
});

test('Snyk delegates internal test pull requests and merged pushes to its CI gate', () => {
  const snyk = security.jobs.snyk;
  assert.equal(snyk.name, 'Snyk security gate');
  assert.equal(
    normalizeExpression(snyk.if),
    normalizeExpression(`
      (github.event_name == 'push' && github.ref == 'refs/heads/test') ||
      (github.event_name == 'pull_request' &&
       github.event.pull_request.base.ref == 'test' &&
       github.event.pull_request.head.repo.full_name == github.repository)
    `),
  );

  const scanStep = snyk.steps.find((step) => step.name === 'Run Snyk finding gate');
  assert.ok(scanStep, 'missing Snyk finding gate');
  assert.equal(scanStep.run, 'npm run security:snyk:ci');
});
