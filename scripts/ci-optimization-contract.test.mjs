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
    const cache = findStep(build.jobs.quality, 'Cache static analysis results');

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
    expect(unitConfigText).toContain("'vendor/**'");
  });
});
