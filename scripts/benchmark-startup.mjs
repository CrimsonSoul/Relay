#!/usr/bin/env node

import { _electron as electron } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractLatestStartupTimeline, median } from './startup-benchmark-utils.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainEntry = path.join(root, 'dist/main/index.js');
const warmRunCount = 5;
const launchTimeoutMs = 60_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error('Could not reserve a local PocketBase port.');
  return port;
}

function writeServerConfig(userDataDir, port, secret) {
  const dataDir = path.join(userDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ mode: 'server', port, secret }, null, 2),
    'utf8',
  );
}

async function readTimeline(logPath) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const timeline = extractLatestStartupTimeline(fs.readFileSync(logPath, 'utf8'));
      if (timeline?.['renderer-mounted'] !== undefined) return timeline;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  return null;
}

async function measureLaunch(userDataDir) {
  const startedAt = performance.now();
  const launchEnv = { ...process.env, NODE_ENV: 'test' };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  let electronApp;
  try {
    electronApp = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, mainEntry],
      env: launchEnv,
      timeout: launchTimeoutMs,
    });
    const window = await electronApp.firstWindow({ timeout: launchTimeoutMs });
    await window.waitForFunction(() => globalThis.document.visibilityState === 'visible', null, {
      timeout: launchTimeoutMs,
    });
    const windowVisibleMs = Math.round(performance.now() - startedAt);
    await window
      .getByTestId('sidebar-compose')
      .waitFor({ state: 'visible', timeout: launchTimeoutMs });
    const workspaceVisibleMs = Math.round(performance.now() - startedAt);
    const timeline = await readTimeline(path.join(userDataDir, 'logs', 'relay.log'));
    return { windowVisibleMs, workspaceVisibleMs, timeline };
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

function summarize(label, result) {
  return {
    label,
    windowVisibleMs: result.windowVisibleMs,
    workspaceVisibleMs: result.workspaceVisibleMs,
    timeline: result.timeline,
  };
}

export async function runStartupBenchmark() {
  if (!fs.existsSync(mainEntry)) {
    throw new Error('Relay is not built. Run `npm run build` before benchmarking startup.');
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-startup-benchmark-'));
  try {
    const port = await reservePort();
    writeServerConfig(userDataDir, port, `benchmark-${crypto.randomUUID()}`);
    const provisioning = await measureLaunch(userDataDir);
    const postUpdate = await measureLaunch(userDataDir);
    const warm = [];
    for (let index = 0; index < warmRunCount; index += 1) {
      warm.push(await measureLaunch(userDataDir));
    }

    const report = {
      provisioning: summarize('fresh install', provisioning),
      postUpdate: summarize('first healthy launch after build/update', postUpdate),
      warmMedian: {
        label: `median of ${warmRunCount} subsequent launches`,
        windowVisibleMs: median(warm.map((sample) => sample.windowVisibleMs)),
        workspaceVisibleMs: median(warm.map((sample) => sample.workspaceVisibleMs)),
      },
      warm: warm.map((sample, index) => summarize(`warm ${index + 1}`, sample)),
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStartupBenchmark().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
