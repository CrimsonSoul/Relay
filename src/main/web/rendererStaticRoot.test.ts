import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveRendererStaticRoot } from './rendererStaticRoot';

describe('resolveRendererStaticRoot', () => {
  it('resolves the one shared renderer bundle beside the built main process', () => {
    const mainEntry = pathToFileURL(resolve('/relay-app/dist/main/index.js')).href;

    expect(resolveRendererStaticRoot(mainEntry)).toBe(resolve('/relay-app/dist/renderer'));
  });
});
