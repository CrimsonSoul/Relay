import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CANONICAL_MARKDOWN = [
  'AGENTS.md',
  'PRODUCT.md',
  'README.md',
  'docs/DESIGN.md',
  'docs/DEVELOPMENT.md',
  'docs/README.md',
  'docs/SECURITY.md',
  'docs/architecture.md',
  'docs/knowledge-base.md',
  'docs/relay-web.md',
];

describe('documentation lifecycle contract', () => {
  it('keeps repository documentation in the approved living set', () => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const trackedMarkdown = execFileSync('git', ['ls-files', '*.md'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort();

    expect(trackedMarkdown).toEqual([...CANONICAL_MARKDOWN].sort());

    const repositoryInstructions = readFileSync('AGENTS.md', 'utf8');
    const documentationIndex = readFileSync('docs/README.md', 'utf8');

    expect(repositoryInstructions).toContain('## Documentation lifecycle');
    expect(repositoryInstructions).toContain('explicit user approval');
    expect(documentationIndex).toContain('## Documentation lifecycle');
  });
});
