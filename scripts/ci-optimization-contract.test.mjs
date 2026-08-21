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

  it('caches only static-analysis artifacts without making the quality gate depend on cache health', async () => {
    const build = await readYaml('.github/workflows/build.yml');
    const cache = findStep(build.jobs.static, 'Cache static analysis results');

    expect(cache).toMatchObject({
      'continue-on-error': true,
      uses: 'actions/cache@v5',
      with: {
        path: '.cache/eslint\n.cache/prettier\n',
        'restore-keys':
          "static-analysis-${{ runner.os }}-${{ hashFiles('package-lock.json', 'eslint.config.js', '.prettierrc', '.prettierignore') }}-",
      },
    });
    expect(cache.with.key).toBe(
      "static-analysis-${{ runner.os }}-${{ hashFiles('package-lock.json', 'eslint.config.js', '.prettierrc', '.prettierignore') }}-${{ github.sha }}",
    );
  });

  it('shards renderer tests behind a fail-closed aggregate build gate', async () => {
    const build = await readYaml('.github/workflows/build.yml');

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
    expect(quality.needs).toEqual(['static', 'unit-tests', 'renderer-tests']);
    const aggregate = findStep(quality, 'Require successful build components');
    expect(aggregate.env).toEqual({
      RENDERER_TESTS_RESULT: '${{ needs.renderer-tests.result }}',
      STATIC_RESULT: '${{ needs.static.result }}',
      UNIT_TESTS_RESULT: '${{ needs.unit-tests.result }}',
    });
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
    expect(findStep(rendererCoverage, 'Generate renderer coverage shard').run).toContain(
      '--reporter=blob --shard=${{ matrix.shard-index }}/${{ matrix.shard-total }}',
    );

    const sonar = security.jobs.sonarqube;
    expect(sonar.name).toBe('SonarQube quality gate');
    expect(sonar.needs).toEqual(['unit-coverage', 'renderer-coverage']);
    const merge = findStep(sonar, 'Merge renderer coverage');
    expect(merge.run).toContain('--merge-reports');
    expect(merge.run).toContain('--coverage.reporter=lcov');
    expect(merge.run).toContain('--coverage.reportsDirectory=coverage/renderer');
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
});
