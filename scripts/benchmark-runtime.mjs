import { _electron as electron } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  collectRuntimeResources,
  selectGpuDiagnostics,
  summarizeProcessSamples,
} from './runtime-benchmark-utils.mjs';

const root = process.cwd();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-runtime-benchmark-'));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const dataDir = path.join(userDataDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, 'config.json'),
  JSON.stringify({
    mode: 'server',
    port: await reservePort(),
    secret: `runtime-benchmark-${crypto.randomUUID()}`,
  }),
);

const env = { ...process.env, NODE_ENV: 'test' };
delete env.ELECTRON_RUN_AS_NODE;
let electronApp;

try {
  electronApp = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, path.join(root, 'dist/main/index.js')],
    env,
    timeout: 60_000,
  });
  const window = await electronApp.firstWindow({ timeout: 60_000 });
  await window.getByTestId('sidebar-compose').waitFor({ state: 'visible', timeout: 60_000 });

  const cdp = await electronApp.context().newCDPSession(window);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Performance.enable')]);
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  const samples = [];
  for (let index = 0; index < 10; index += 1) {
    const processes = await electronApp.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({
        type: metric.type,
        name: metric.name,
        cpu: metric.cpu?.percentCPUUsage ?? 0,
        workingSetMB: Number(((metric.memory?.workingSetSize ?? 0) / 1024).toFixed(1)),
      })),
    );
    const performanceMetrics = await cdp.send('Performance.getMetrics');
    const dom = await cdp.send('Memory.getDOMCounters');
    const metrics = Object.fromEntries(
      performanceMetrics.metrics.map(({ name, value }) => [name, value]),
    );
    samples.push({
      processes,
      dom,
      taskDuration: metrics.TaskDuration ?? 0,
      jsHeapUsedMB: Number(((metrics.JSHeapUsedSize ?? 0) / 1024 / 1024).toFixed(1)),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const gpu = await electronApp.evaluate(async ({ app }) => ({
    accelerated: app.isHardwareAccelerationEnabled(),
    features: app.getGPUFeatureStatus(),
    basic: await app.getGPUInfo('basic'),
  }));
  const resourceTree = await cdp.send('Page.getResourceTree');
  const animatedElements = await window.evaluate(() =>
    [...document.querySelectorAll('*')]
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          willChange: style.willChange,
        };
      })
      .filter(({ animationName, willChange }) => animationName !== 'none' || willChange !== 'auto'),
  );
  const first = samples[0];
  const last = samples.at(-1);

  console.log(
    JSON.stringify(
      {
        sampleWindowSeconds: 10,
        processes: summarizeProcessSamples(samples.map((sample) => sample.processes)),
        renderer: {
          jsHeapUsedMB: last.jsHeapUsedMB,
          documents: last.dom.documents,
          nodes: last.dom.nodes,
          jsEventListeners: last.dom.jsEventListeners,
          taskDurationDeltaSeconds: Number((last.taskDuration - first.taskDuration).toFixed(4)),
        },
        loadedResources: collectRuntimeResources(resourceTree.frameTree),
        animatedElements,
        gpu: selectGpuDiagnostics(gpu),
      },
      null,
      2,
    ),
  );
} finally {
  await electronApp?.close().catch(() => undefined);
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
