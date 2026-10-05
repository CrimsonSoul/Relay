import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      for (const name of ['writeFile', 'sync', 'close'] as const) {
        const original = handle[name].bind(handle) as (...values: unknown[]) => Promise<void>;
        Object.assign(handle, {
          [name]: (...values: unknown[]) => {
            operations.calls.push(name);
            return original(...values);
          },
        });
      }
      return handle;
    },
    rename: (...args: Parameters<typeof actual.rename>) => {
      operations.calls.push('rename');
      return actual.rename(...args);
    },
  };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const record =
    <T extends (...args: never[]) => unknown>(name: string, original: T) =>
    (...args: Parameters<T>) => {
      operations.calls.push(name);
      return original(...args);
    };
  return {
    ...actual,
    writeFileSync: record('writeFile', actual.writeFileSync),
    fsyncSync: record('sync', actual.fsyncSync),
    closeSync: record('close', actual.closeSync),
    renameSync: record('rename', actual.renameSync),
  };
});
import {
  flushFile,
  replaceFileDurably,
  replaceFileDurablySync,
  type DurableReplaceOptions,
} from './durableFile';

const variants: Array<
  [
    string,
    (
      temporary: string,
      target: string,
      contents: string | Uint8Array,
      options?: DurableReplaceOptions,
    ) => Promise<void>,
  ]
> = [
  ['replaceFileDurably', replaceFileDurably],
  [
    'replaceFileDurablySync',
    async (...args) => {
      replaceFileDurablySync(...args);
    },
  ],
];

describe.each(variants)('%s', (_name, replace) => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'relay-durable-file-'));
    operations.calls.length = 0;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('flushes the new contents to disk before they replace the previous file', async () => {
    const target = join(directory, 'config.json');
    await writeFile(target, 'previous');

    await replace(join(directory, '.config.tmp'), target, 'next\r\n', { exclusive: true });

    expect(operations.calls).toEqual(['writeFile', 'sync', 'close', 'rename']);
    expect(await readFile(target, 'utf8')).toBe('next\r\n');
    expect(await readdir(directory)).toEqual(['config.json']);
  });

  it('overwrites a leftover fixed temporary file unless the caller requires a new one', async () => {
    const target = join(directory, 'config.json');
    const temporary = join(directory, 'config.json.tmp');
    await writeFile(temporary, 'interrupted save');

    await expect(replace(temporary, target, 'refused', { exclusive: true })).rejects.toThrow();
    await writeFile(temporary, 'interrupted save');
    await replace(temporary, target, Buffer.from('saved'));

    expect(await readFile(target, 'utf8')).toBe('saved');
    expect(await readdir(directory)).toEqual(['config.json']);
  });

  it('keeps the previous file and removes the temporary file when publishing fails', async () => {
    const target = join(directory, 'missing', 'config.json');
    const temporary = join(directory, '.config.tmp');

    await expect(replace(temporary, target, 'next')).rejects.toThrow();

    expect(await readdir(directory)).toEqual([]);
  });
});

describe('flushFile', () => {
  it('flushes an existing file without changing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-durable-file-'));
    try {
      const path = join(directory, 'data.db');
      await writeFile(path, 'contents');
      operations.calls.length = 0;

      await flushFile(path);

      expect(operations.calls).toEqual(['sync', 'close']);
      expect(await readFile(path, 'utf8')).toBe('contents');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
