import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';
import type { RelayWebServerState } from './RelayWebServerState';

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export type RelayWebServerOptions = {
  host: string;
  port: number;
  staticRoot: string;
  onStateChanged?: (state: RelayWebServerState) => void;
};

function publicState(state: RelayWebServerState): RelayWebServerState {
  return { ...state };
}

function send(response: ServerResponse, status: number, body = ''): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(body);
}

export class RelayWebServer {
  private server: Server | null = null;
  private startPromise: Promise<RelayWebServerState> | null = null;
  private state: RelayWebServerState;

  constructor(private readonly options: RelayWebServerOptions) {
    this.state = { status: 'disabled', host: options.host, port: options.port };
  }

  getState(): RelayWebServerState {
    return publicState(this.state);
  }

  async start(): Promise<RelayWebServerState> {
    if (this.state.status === 'available') return this.getState();
    if (this.startPromise) return this.startPromise;
    this.setState({ status: 'starting', host: this.options.host, port: this.options.port });
    this.startPromise = this.listen();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.startPromise) await this.startPromise;
    const server = this.server;
    this.server = null;
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
    this.setState({ status: 'disabled', host: this.options.host, port: this.options.port });
  }

  async retry(): Promise<RelayWebServerState> {
    await this.stop();
    return this.start();
  }

  private listen(): Promise<RelayWebServerState> {
    return new Promise((resolveStart) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request.url ?? '/', request.method ?? 'GET', response);
      });
      this.server = server;
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.server = null;
        const conflict = error.code === 'EADDRINUSE';
        this.setState({
          status: conflict ? 'conflict' : 'failed',
          host: this.options.host,
          port: this.options.port,
          error: conflict ? 'port-conflict' : 'startup-failed',
        });
        resolveStart(this.getState());
      });
      server.listen(this.options.port, this.options.host, () => {
        this.setState({
          status: 'available',
          host: this.options.host,
          port: this.options.port,
          url: `http://${this.options.host}:${this.options.port}`,
        });
        resolveStart(this.getState());
      });
    });
  }

  private async handleRequest(rawUrl: string, method: string, response: ServerResponse) {
    if (method !== 'GET' && method !== 'HEAD') {
      send(response, 405, 'Method not allowed');
      return;
    }
    const rawPath = rawUrl.split('?', 1)[0] || '/';
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      send(response, 400, 'Invalid path');
      return;
    }
    if (pathname.split('/').some((segment) => segment === '..')) {
      send(response, 400, 'Invalid path');
      return;
    }
    if (pathname === RELAY_WEB_API_PREFIX || pathname.startsWith(`${RELAY_WEB_API_PREFIX}/`)) {
      send(response, 404, 'Not found');
      return;
    }

    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = resolve(this.options.staticRoot, requested);
    const relativePath = relative(this.options.staticRoot, candidate);
    if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
      send(response, 400, 'Invalid path');
      return;
    }
    if (await this.serveFile(candidate, method, response)) return;
    if (await this.serveFile(resolve(this.options.staticRoot, 'index.html'), method, response))
      return;
    send(response, 404, 'Not found');
  }

  private async serveFile(
    path: string,
    method: string,
    response: ServerResponse,
  ): Promise<boolean> {
    try {
      const details = await stat(path);
      if (!details.isFile()) return false;
      response.statusCode = 200;
      response.setHeader(
        'Content-Type',
        MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      );
      response.setHeader('Content-Length', String(details.size));
      if (method === 'HEAD') {
        response.end();
      } else {
        createReadStream(path).pipe(response);
      }
      return true;
    } catch {
      return false;
    }
  }

  private setState(state: RelayWebServerState): void {
    this.state = state;
    this.options.onStateChanged?.(this.getState());
  }
}
