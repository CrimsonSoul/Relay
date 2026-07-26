import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release workflow authority boundary', () => {
  it('selects the reviewed immutable release action revision', async () => {
    const workflow = await readFile(
      new URL('../.github/workflows/release.yml', import.meta.url),
      'utf8',
    );
    const prefix = 'uses: softprops/action-gh-release@';
    const releaseActionLine = workflow
      .split(/\r?\n/u)
      .map((line) => line.trimStart())
      .find((line) => line.startsWith(prefix));
    const releaseAction = releaseActionLine?.slice(prefix.length).split(/\s/u, 1)[0];

    expect(releaseAction).toBe('3bb12739c298aeb8a4eeaf626c5b8d85266b0e65');
    expect(releaseAction).toMatch(/^[a-f0-9]{40}$/u);
  });
});
