import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import type { Session } from 'electron';

test('Radar polling and sign-in accept its private CA without weakening other sessions or hosts', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'relay-radar-tls-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const key = join(fixture, 'key.pem');
    const cert = join(fixture, 'cert.pem');
    const config = join(fixture, 'openssl.cnf');
    writeFileSync(
      config,
      '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=cw-intra-web\n[ext]\nsubjectAltName=DNS:cw-intra-web,DNS:other.example.test\n',
    );
    // Test-only certificate generation uses the developer/CI OpenSSL installation.
    execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        cert,
        '-config',
        config,
      ],
      { stdio: 'ignore' },
    );
    server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<title>Radar private CA fixture</title><h1>Radar loaded</h1>');
    });
    await new Promise<void>((resolveListen) => server!.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TLS fixture has no port');
    const url = `https://cw-intra-web:${address.port}/CWDashboard/Home/Radar`;
    await build({
      entryPoints: [resolve('src/main/handlers/radar/radarSession.ts')],
      outfile: join(fixture, 'radar.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      tsconfig: resolve('tsconfig.node.json'),
      plugins: [
        {
          name: 'fixture-logger',
          setup(builder) {
            builder.onResolve({ filter: /\/logger$/ }, () => ({
              path: 'logger',
              namespace: 'fixture',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: 'export const loggers = {security: {warn() {}}};',
            }));
          },
        },
      ],
    });
    const main = join(fixture, 'main.cjs');
    writeFileSync(
      main,
      `
      const {app,BrowserWindow}=require('electron');
      app.dock?.hide();
      app.commandLine.appendSwitch('host-resolver-rules', 'MAP cw-intra-web 127.0.0.1, MAP other.example.test 127.0.0.1');
      app.commandLine.appendSwitch('no-proxy-server');
      globalThis.radarTest=require('./radar.cjs');
      app.whenReady().then(()=>new BrowserWindow({show:false}).loadURL('about:blank'));
    `,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      args: [`--user-data-dir=${join(fixture, 'profile')}`, main],
      env,
    });
    const result = await app.evaluate(async ({ BrowserWindow, session }, target) => {
      const radar = (
        globalThis as unknown as {
          radarTest: { getRadarSession: () => Session };
        }
      ).radarTest.getRadarSession();
      const fetchResult = async (ses: Session, requestUrl: string) => {
        try {
          return await (await ses.fetch(requestUrl)).text();
        } catch (error) {
          return String(error);
        }
      };
      const ordinary = await fetchResult(session.defaultSession, target);
      const polling = await fetchResult(radar, target);
      const otherHost = await fetchResult(
        radar,
        target.replace('cw-intra-web', 'other.example.test'),
      );
      const window = new BrowserWindow({
        show: false,
        webPreferences: { session: radar, sandbox: true },
      });
      try {
        await window.loadURL(target);
        return { ordinary, polling, otherHost, title: window.getTitle() };
      } finally {
        window.destroy();
      }
    }, url);
    expect(result.ordinary).toContain('ERR_CERT_AUTHORITY_INVALID');
    expect(result.otherHost).toContain('ERR_CERT_AUTHORITY_INVALID');
    expect(result.polling).toContain('Radar loaded');
    expect(result.title).toBe('Radar private CA fixture');
  } finally {
    await app?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    rmSync(fixture, { recursive: true, force: true });
  }
});
