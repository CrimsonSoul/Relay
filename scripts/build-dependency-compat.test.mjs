import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint'));

describe('build dependency compatibility', () => {
  it('resolves external, relative and fragment references through the ESLint Ajv dependency', () => {
    const Ajv = eslintRequire('ajv');
    const ajv = new Ajv();
    ajv.addSchema({
      $id: 'https://schemas.example.test/shared.json',
      definitions: { name: { type: 'string', minLength: 2 } },
    });
    const validate = ajv.compile({
      $id: 'https://schemas.example.test/rules/settings.json',
      type: 'object',
      properties: { name: { $ref: '../shared.json#/definitions/name' } },
      required: ['name'],
      additionalProperties: false,
    });
    expect(validate({ name: 'NOC' })).toBe(true);
    for (const value of [{ name: 'x' }, { name: 42 }, {}, { name: 'NOC', extra: true }]) {
      expect(validate(value)).toBe(false);
    }
  });

  it('bounds URI resolution for Unicode line and paragraph separators', () => {
    const ajvRequire = createRequire(eslintRequire.resolve('ajv'));
    const uriPath = ajvRequire.resolve('uri-js');
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const uri = require(process.argv[1]);
         for (const c of ['\\u2028', '\\u2029']) {
           const value = uri.resolve('https://example.test/a/', c + '../b', { iri: true });
           if (typeof value !== 'string') process.exit(1);
         }`,
        uriPath,
      ],
      { timeout: 3000, encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('downloads through the builder dependency, verifies checksums and reuses its cache', async () => {
    const builderRequire = createRequire(require.resolve('app-builder-lib'));
    const { downloadArtifact } = builderRequire('@electron/get');
    const directory = await mkdtemp(join(tmpdir(), 'relay-downloader-test-'));
    const body = Buffer.from('isolated build artifact');
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { 'content-length': body.length });
      response.end(body);
    });
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const url = `http://127.0.0.1:${address.port}/artifact.zip`;
      const options = {
        version: '42.11.2',
        artifactName: 'fixture.zip',
        isGeneric: true,
        cacheRoot: directory,
        mirrorOptions: { resolveAssetURL: () => Promise.resolve(url) },
        checksums: { 'fixture.zip': createHash('sha256').update(body).digest('hex') },
        downloadOptions: { quiet: true, signal: AbortSignal.timeout(5000) },
      };
      const file = await downloadArtifact(options);
      expect(await readFile(file)).toEqual(body);
      expect(await downloadArtifact(options)).toBe(file);
      expect(requests).toBe(1);
      await expect(
        downloadArtifact({ ...options, force: true, checksums: { 'fixture.zip': '0'.repeat(64) } }),
      ).rejects.toThrow();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
