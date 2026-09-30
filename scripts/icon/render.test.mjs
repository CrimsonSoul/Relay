import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const source = readFileSync(new URL('./render.cjs', import.meta.url), 'utf8');

async function renderFailure(failedPhase) {
  const failure = new Error(`${failedPhase} failed`);
  const reported = [];
  const processState = { argv: ['electron', 'render.cjs', 'mac'], exitCode: 0 };
  let quitCount = 0;
  const electron = {
    app: {
      disableHardwareAcceleration() {},
      whenReady: () => (failedPhase === 'startup' ? Promise.reject(failure) : Promise.resolve()),
      quit: () => {
        quitCount += 1;
      },
    },
    BrowserWindow: class {
      loadFile() {
        return Promise.reject(failure);
      }
    },
  };
  // The only evaluated input is the checked-in script above, with fake Electron and filesystem APIs.
  // eslint-disable-next-line sonarjs/code-eval
  await runInNewContext(source, {
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'node:path') return path;
      if (name === 'node:fs') return {};
      throw new Error(`Unexpected module: ${name}`);
    },
    __dirname: path.dirname(fileURLToPath(import.meta.url)),
    process: processState,
    console: { error: (error) => reported.push(error) },
  });
  assert.equal(processState.exitCode, 1);
  assert.equal(quitCount, 1);
  assert.deepEqual(reported, [failure]);
}

test('icon rendering reports and quits after Electron startup rejects', async () => {
  await renderFailure('startup');
});

test('icon rendering reports and quits after the page fails to load', async () => {
  await renderFailure('page');
});
