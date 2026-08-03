import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runTypecheck } from './typecheck.mjs';

test('fails when tsc returns a configuration error with no file diagnostic', () => {
  const outcome = runTypecheck({
    projects: ['missing.json'],
    spawn: () => ({ status: 1, stdout: 'error TS5058: missing', stderr: '' }),
  });

  assert.equal(outcome.ok, false);
});

test('fails when tsc cannot be spawned or is terminated', () => {
  assert.equal(
    runTypecheck({
      projects: ['node'],
      spawn: () => ({
        status: null,
        signal: 'SIGTERM',
        error: new Error('spawn failed'),
      }),
    }).ok,
    false,
  );
});
