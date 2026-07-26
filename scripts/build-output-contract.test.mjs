import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const electronViteCli = path.join(
  repositoryRoot,
  'node_modules',
  'electron-vite',
  'bin',
  'electron-vite.js',
);
const applicationChunkLimitBytes = 500_000;
const buildTimeoutMs = 60_000;
const testTimeoutMs = buildTimeoutMs + 5_000;

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );

  return files.flat();
}

function formatBuildFailure(result, output) {
  if (result.error) return result.error.stack ?? result.error.message;
  return `electron-vite exited with status ${result.status}\n${output}`;
}

test(
  'production build emits bounded non-empty application chunks and a separate PDF worker',
  { timeout: testTimeoutMs },
  async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), 'relay-build-output-contract-'));

    try {
      const result = spawnSync(
        process.execPath,
        [electronViteCli, 'build', '--outDir', outputRoot],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: { ...process.env, FORCE_COLOR: '0', RELAY_BUILD_OUTPUT_CONTRACT: '1' },
          maxBuffer: 100 * 1024 * 1024,
          timeout: buildTimeoutMs,
        },
      );
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

      assert.equal(result.status, 0, formatBuildFailure(result, output));
      assert.doesNotMatch(output, /generated an empty chunk/i);
      assert.doesNotMatch(output, /circular chunk:/i);
      assert.doesNotMatch(output, /some chunks are larger than [\d.,]+ kB after minification/i);

      const rendererRoot = path.join(outputRoot, 'renderer');
      const outputFiles = await listFiles(outputRoot);
      const manifestPath = path.join(rendererRoot, 'build-output-contract-manifest.json');
      let manifest;
      await assert.doesNotReject(async () => {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      }, 'expected the build-output contract manifest');
      const pdfWorkers = outputFiles.filter((file) => {
        const relativePath = path.relative(rendererRoot, file);
        return (
          relativePath.startsWith(`assets${path.sep}`) &&
          /^pdf\.worker(?:\.min)?-[^/\\]+\.mjs$/.test(path.basename(file))
        );
      });

      assert.equal(
        pdfWorkers.length,
        1,
        `expected one separate PDF worker asset, found: ${pdfWorkers
          .map((file) => path.relative(rendererRoot, file))
          .join(', ')}`,
      );

      const applicationChunks = outputFiles.filter(
        (file) => /\.(?:[cm]?js)$/.test(file) && !pdfWorkers.includes(file),
      );

      assert.ok(applicationChunks.length > 0, 'expected application JavaScript chunks');

      const emptyChunks = [];
      const oversizedChunks = [];
      for (const chunk of applicationChunks) {
        const [contents, metadata] = await Promise.all([readFile(chunk, 'utf8'), stat(chunk)]);
        const relativePath = path.relative(outputRoot, chunk);
        if (contents.trim().length === 0) emptyChunks.push(relativePath);
        if (metadata.size > applicationChunkLimitBytes) {
          oversizedChunks.push(`${relativePath} (${metadata.size} bytes)`);
        }
      }

      assert.deepEqual(emptyChunks, [], `empty application chunks: ${emptyChunks.join(', ')}`);
      assert.deepEqual(
        oversizedChunks,
        [],
        `application chunks over ${applicationChunkLimitBytes} bytes: ${oversizedChunks.join(', ')}`,
      );

      const vendorChunk = (name) => {
        const matches = Object.entries(manifest).filter(([, entry]) => entry.name === name);
        assert.equal(matches.length, 1, `expected one ${name} chunk`);
        const [key, entry] = matches[0];
        assert.ok(
          applicationChunks.includes(path.join(rendererRoot, entry.file)),
          `expected emitted application chunk for ${name}`,
        );
        return { key, entry };
      };
      const reactVendor = vendorChunk('react-vendor');
      const dndVendor = vendorChunk('dnd-vendor');
      const virtualVendor = vendorChunk('virtual-vendor');
      vendorChunk('pdf-vendor');
      const importsChunk = (importer, imported) =>
        new Set(importer.entry.imports ?? []).has(imported.key);

      assert.equal(
        importsChunk(dndVendor, reactVendor),
        true,
        'dnd-vendor must import react-vendor',
      );
      assert.equal(
        importsChunk(virtualVendor, reactVendor),
        true,
        'virtual-vendor must import react-vendor',
      );
      assert.equal(
        importsChunk(reactVendor, dndVendor),
        false,
        'react-vendor must not import dnd-vendor',
      );
      assert.equal(
        importsChunk(reactVendor, virtualVendor),
        false,
        'react-vendor must not import virtual-vendor',
      );
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  },
);
