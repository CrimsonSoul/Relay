import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { app } from 'electron';
import {
  isTrustedIpcSender,
  assertTrustedIpcSender,
  isAllowedRendererFileUrl,
} from './trustedSender';
import { loggers } from '../logger';

// Mock electron app — isPackaged is mutated per-test
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    security: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

const mockApp = app as unknown as { isPackaged: boolean };

function makeEvent(frameUrl: string, isMainFrame = true) {
  const frame = { url: frameUrl } as unknown as Electron.WebFrameMain;
  return {
    senderFrame: frame,
    sender: { mainFrame: isMainFrame ? frame : ({} as Electron.WebFrameMain) },
  } as Parameters<typeof isTrustedIpcSender>[0];
}

describe('isTrustedIpcSender', () => {
  const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.isPackaged = false;
    delete process.env.ELECTRON_RENDERER_URL;
  });

  afterEach(() => {
    if (originalRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL;
    } else {
      process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
    }
  });

  it('rejects a null senderFrame', () => {
    expect(isTrustedIpcSender({ senderFrame: null, sender: { mainFrame: null } } as never)).toBe(
      false,
    );
  });

  it('rejects subframes', () => {
    expect(isTrustedIpcSender(makeEvent('file:///anything', false))).toBe(false);
  });

  it('rejects http origins in packaged mode', () => {
    mockApp.isPackaged = true;
    expect(isTrustedIpcSender(makeEvent('https://evil.example/index.html'))).toBe(false);
  });

  it('rejects the dev-server origin when packaged, even with the env var set', () => {
    mockApp.isPackaged = true;
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    expect(isTrustedIpcSender(makeEvent('http://localhost:5173/'))).toBe(false);
  });

  it('rejects http origins in dev when ELECTRON_RENDERER_URL is unset', () => {
    expect(isTrustedIpcSender(makeEvent('http://localhost:5173/'))).toBe(false);
  });

  it('rejects a different origin than the dev server in dev', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    expect(isTrustedIpcSender(makeEvent('http://evil.example:5173/'))).toBe(false);
  });

  it('accepts the dev-server origin in dev', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
    expect(isTrustedIpcSender(makeEvent('http://localhost:5173/index.html'))).toBe(true);
  });

  it('accepts a renderer file: URL in packaged mode', () => {
    mockApp.isPackaged = true;
    // trustedSender resolves the renderer dir as <its dir>/../renderer
    const rendererIndex = new URL('../renderer/index.html', import.meta.url).href;
    expect(isTrustedIpcSender(makeEvent(rendererIndex))).toBe(true);
  });

  it('rejects file: URLs outside the renderer dir in packaged mode', () => {
    mockApp.isPackaged = true;
    expect(isTrustedIpcSender(makeEvent('file:///etc/passwd'))).toBe(false);
  });

  it('rejects garbage frame URLs', () => {
    expect(isTrustedIpcSender(makeEvent('not-a-url'))).toBe(false);
  });
});

describe('assertTrustedIpcSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.isPackaged = true;
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it('returns true and stays silent for trusted senders', () => {
    const rendererIndex = new URL('../renderer/index.html', import.meta.url).href;
    expect(assertTrustedIpcSender(makeEvent(rendererIndex), 'some:channel')).toBe(true);
    expect(loggers.security.warn).not.toHaveBeenCalled();
  });

  it('returns false and logs the channel for untrusted senders', () => {
    expect(assertTrustedIpcSender(makeEvent('https://evil.example/'), 'some:channel')).toBe(false);
    expect(loggers.security.warn).toHaveBeenCalledWith('Rejected IPC from untrusted sender', {
      channel: 'some:channel',
    });
  });
});

describe('isAllowedRendererFileUrl', () => {
  const rendererDir = '/app/dist/renderer';

  it('accepts files inside the renderer dir', () => {
    expect(isAllowedRendererFileUrl('file:///app/dist/renderer/index.html', rendererDir)).toBe(
      true,
    );
  });

  it('rejects traversal outside the renderer dir', () => {
    expect(
      isAllowedRendererFileUrl('file:///app/dist/renderer/../main/index.js', rendererDir),
    ).toBe(false);
  });

  it('rejects non-file protocols', () => {
    expect(isAllowedRendererFileUrl('https://example.com/index.html', rendererDir)).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isAllowedRendererFileUrl('not a url', rendererDir)).toBe(false);
  });
});
