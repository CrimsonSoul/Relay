import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { SCANNER_OUTCOME, ScannerGateError } from './scanner-gate-policy.mjs';
import { runSnykCi } from './run-snyk-ci.mjs';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');

const configuredEnv = {
  SNYK_ORG: 'crimsonsoul',
  SNYK_TOKEN: 'snyk-token-sentinel-never-print',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/pull/221/merge',
  GITHUB_REPOSITORY: 'CrimsonSoul/Relay',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_SHA: 'abc123',
};

const commandResult = (code, output = '', timedOut = false) => ({ code, output, timedOut });

test('runs Open Source and Code with exact bounded repository arguments on pull requests', async () => {
  const commands = [];
  const result = await runSnykCi({
    env: configuredEnv,
    runCommand: async (command) => {
      commands.push(command);
      return commandResult(0);
    },
  });

  assert.equal(result.outcome, SCANNER_OUTCOME.CLEAN);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0].args, [
    'run',
    'security:snyk:open-source',
    '--',
    '--org=crimsonsoul',
    '--project-name=CrimsonSoul/Relay',
    '--target-reference=main',
    '--remote-repo-url=https://github.com/CrimsonSoul/Relay.git',
  ]);
  assert.deepEqual(commands[1].args, ['run', 'security:snyk:code', '--', '--org=crimsonsoul']);
  for (const command of commands) {
    assert.match(command.file, /npm(?:\.cmd)?$/u);
    assert.equal(command.timeoutMs, 600_000);
    assert.equal(command.maxOutputBytes, 32_768);
    assert.ok(command.transientOutput instanceof RegExp);
    assert.equal(command.args.join(' ').includes(configuredEnv.SNYK_TOKEN), false);
  }
});

test('adds the monitor command only after clean scans on a main-branch push', async () => {
  const commands = [];
  const result = await runSnykCi({
    env: {
      ...configuredEnv,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
    },
    runCommand: async (command) => {
      commands.push(command.args);
      return commandResult(0);
    },
  });

  assert.equal(result.outcome, SCANNER_OUTCOME.CLEAN);
  assert.deepEqual(
    commands.map((args) => args[1]),
    ['security:snyk:open-source', 'security:snyk:code', 'security:snyk:monitor'],
  );
  assert.deepEqual(commands[2].slice(3), commands[0].slice(3));
});

test('runs only the monitor when a reused main commit already has validated scan evidence', async () => {
  const commands = [];
  const result = await runSnykCi({
    env: {
      ...configuredEnv,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
    },
    monitorOnly: true,
    runCommand: async (command) => {
      commands.push(command.args);
      return commandResult(0);
    },
  });

  assert.equal(result.outcome, SCANNER_OUTCOME.CLEAN);
  assert.deepEqual(
    commands.map((args) => args[1]),
    ['security:snyk:monitor'],
  );
  assert.deepEqual(commands[0].slice(3), [
    '--org=crimsonsoul',
    '--project-name=CrimsonSoul/Relay',
    '--target-reference=main',
    '--remote-repo-url=https://github.com/CrimsonSoul/Relay.git',
  ]);
});

test('rejects monitor-only execution outside a main-branch push', async () => {
  let ran = false;
  await assert.rejects(
    runSnykCi({
      env: configuredEnv,
      monitorOnly: true,
      runCommand: async () => {
        ran = true;
        return commandResult(0);
      },
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.CONFIGURATION,
  );
  assert.equal(ran, false);
});

test('blocks documented finding exit 1 and stops before later phases', async () => {
  const commands = [];
  await assert.rejects(
    runSnykCi({
      env: configuredEnv,
      runCommand: async (command) => {
        commands.push(command.args[1]);
        return commandResult(1, 'high severity vulnerability found');
      },
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.FINDING,
  );
  assert.deepEqual(commands, ['security:snyk:open-source']);
});

test('reports and fails closed for documented temporary exits, timeouts, and transient failures', async () => {
  for (const scanResult of [
    commandResult(69),
    commandResult(75),
    commandResult(null, '', true),
    commandResult(2, 'HTTP 429 rate limit reached'),
    commandResult(2, 'request failed with ECONNRESET'),
  ]) {
    const reports = [];
    await assert.rejects(
      runSnykCi({
        env: configuredEnv,
        runCommand: async () => scanResult,
        reportUnavailable: (report) => reports.push(report),
      }),
      (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.UNAVAILABLE,
    );
    assert.equal(reports.length, 1);
    assert.equal(reports[0].reason.includes(configuredEnv.SNYK_TOKEN), false);
  }
});

test('keeps unknown and documented configuration exits blocking', async () => {
  for (const scanResult of [
    commandResult(2, 'generic scanner failure'),
    commandResult(3, 'HTTP 503 but no supported projects detected'),
    commandResult(77, 'service unavailable but permission denied'),
    commandResult(null, 'scanner configuration failed'),
  ]) {
    await assert.rejects(
      runSnykCi({
        env: configuredEnv,
        runCommand: async () => scanResult,
      }),
      (error) =>
        error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.CONFIGURATION,
    );
  }
});

test('reports monitor unavailability and keeps every monitor failure blocking', async () => {
  const pushEnv = {
    ...configuredEnv,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
  };
  const reports = [];
  let call = 0;
  await assert.rejects(
    runSnykCi({
      env: pushEnv,
      runCommand: async () => {
        call += 1;
        return call === 3 ? commandResult(75) : commandResult(0);
      },
      reportUnavailable: (report) => reports.push(report),
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.UNAVAILABLE,
  );
  assert.equal(reports.length, 1);

  call = 0;
  await assert.rejects(
    runSnykCi({
      env: pushEnv,
      runCommand: async () => {
        call += 1;
        return call === 3 ? commandResult(1, 'monitor rejected project') : commandResult(0);
      },
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.CONFIGURATION,
  );
});

test('uses one aggregate deadline across sequential Snyk phases', async () => {
  let clock = 0;
  const commands = [];
  const reports = [];
  await assert.rejects(
    runSnykCi({
      env: {
        ...configuredEnv,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
      },
      now: () => clock,
      runCommand: async (command) => {
        commands.push(command);
        clock += commands.length === 1 ? 600_000 : 480_000;
        return commandResult(0);
      },
      reportUnavailable: (report) => reports.push(report),
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.UNAVAILABLE,
  );
  assert.equal(commands.length, 2);
  assert.equal(commands[0].timeoutMs, 600_000);
  assert.equal(commands[1].timeoutMs, 480_000);
  assert.equal(reports.length, 1);
});

test('reports and blocks a transient monitor-only refresh failure', async () => {
  const reports = [];
  await assert.rejects(
    runSnykCi({
      env: {
        ...configuredEnv,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
      },
      monitorOnly: true,
      runCommand: async () => commandResult(75),
      reportUnavailable: (report) => reports.push(report),
    }),
    (error) => error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.UNAVAILABLE,
  );
  assert.equal(reports.length, 1);
});

test('rejects missing credentials and unsupported GitHub context before scanning', async () => {
  for (const env of [
    { ...configuredEnv, SNYK_TOKEN: '' },
    { ...configuredEnv, SNYK_ORG: '' },
    { ...configuredEnv, GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { ...configuredEnv, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/test' },
    { ...configuredEnv, GITHUB_REPOSITORY: '../other' },
    {
      ...configuredEnv,
      GITHUB_SERVER_URL: ['http:', '//github.invalid'].join(''),
    },
  ]) {
    let scanned = false;
    await assert.rejects(
      runSnykCi({
        env,
        runCommand: async () => {
          scanned = true;
          return commandResult(0);
        },
      }),
      (error) =>
        error instanceof ScannerGateError && error.outcome === SCANNER_OUTCOME.CONFIGURATION,
    );
    assert.equal(scanned, false);
  }
});

test('limits the temporary Electron metadata exception to the pinned patched dependency', () => {
  const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  const policy = parse(read('.snyk'));
  const manifest = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const version = manifest.devDependencies.electron;
  assert.equal(lock.packages['node_modules/electron'].version, version);
  const [major, minor, patch] = version.split('.').map(Number);
  assert.ok(major === 42 && (minor > 5 || (minor === 5 && patch >= 2)));

  assert.deepEqual(Object.keys(policy.ignore), ['SNYK-JS-ELECTRON-20335498']);
  const exceptions = policy.ignore['SNYK-JS-ELECTRON-20335498'];
  assert.equal(exceptions.length, 1);
  const path = `${manifest.name}@${manifest.version} > electron@${version}`;
  assert.deepEqual(Object.keys(exceptions[0]), [path]);
  const exception = exceptions[0][path];
  assert.match(
    exception.reason,
    /https:\/\/github\.com\/electron\/electron\/security\/advisories\/GHSA-hq2x-r82h-9wj4/u,
  );
  const expires = Date.parse(exception.expires);
  const approvalDayEnd = Date.parse('2026-10-04T23:59:59.999Z');
  assert.ok(expires > approvalDayEnd && expires <= approvalDayEnd + 7 * 24 * 60 * 60 * 1000);
  assert.deepEqual(policy.patch, {});
});
