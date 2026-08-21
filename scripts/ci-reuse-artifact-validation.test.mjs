import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateReuseArtifacts,
  runCiReuseArtifactValidation,
} from './ciReuseArtifactValidation.mjs';

const pullRequest = '243';
const baseSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const headSha = 'cccccccccccccccccccccccccccccccccccccccc';
const attestation = `pull_request=${pullRequest}\nbase_sha=${baseSha}\nhead_sha=${headSha}\n`;
const unitLcov = 'TN:\nSF:src/unit.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n';
const rendererLcov = 'TN:\nSF:src/renderer.tsx\nDA:4,0\nLF:1\nLH:0\nend_of_record\n';
const zeroLineCssRecord =
  'TN:\nSF:src/renderer/styles.css\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nLF:0\nLH:0\nend_of_record\n';

const validInput = {
  baseSha,
  buildDownloadOutcome: 'success',
  buildFiles: [{ content: attestation, path: 'relay-pr-provenance.txt' }],
  coverageDownloadOutcome: 'success',
  coverageFiles: [
    { content: unitLcov, path: 'unit/lcov.info' },
    { content: rendererLcov, path: 'renderer/lcov.info' },
  ],
  headSha,
  metadataEligible: true,
  metadataReason: 'eligible',
  mode: 'enabled',
  pullRequest,
};

describe('evaluateReuseArtifacts', () => {
  it('enables reuse only after both exact artifact payloads validate in enabled mode', () => {
    expect(evaluateReuseArtifacts(validInput)).toEqual({
      eligible: true,
      mode: 'enabled',
      reason: 'eligible',
      reuse: true,
    });
    expect(evaluateReuseArtifacts({ ...validInput, mode: 'shadow' })).toEqual({
      eligible: true,
      mode: 'shadow',
      reason: 'eligible',
      reuse: false,
    });
    expect(evaluateReuseArtifacts({ ...validInput, mode: 'ENABLED' })).toEqual({
      eligible: true,
      mode: 'shadow',
      reason: 'eligible',
      reuse: false,
    });
  });

  it('preserves sanitized metadata ineligibility without trusting candidate payloads', () => {
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        buildFiles: [{ content: 'private response body', path: 'unexpected.txt' }],
        metadataEligible: false,
        metadataReason: 'event-ineligible',
      }),
    ).toEqual({
      eligible: false,
      mode: 'enabled',
      reason: 'event-ineligible',
      reuse: false,
    });
  });

  it('rejects a failed or skipped candidate artifact download', () => {
    expect(
      evaluateReuseArtifacts({ ...validInput, buildDownloadOutcome: 'failure' }),
    ).toMatchObject({ eligible: false, reason: 'build-download-failed', reuse: false });
    expect(
      evaluateReuseArtifacts({ ...validInput, coverageDownloadOutcome: 'skipped' }),
    ).toMatchObject({ eligible: false, reason: 'coverage-download-failed', reuse: false });
  });

  it('requires the sole Build attestation file to have exact PR, base, and head contents', () => {
    expect(evaluateReuseArtifacts({ ...validInput, buildFiles: [] })).toMatchObject({
      eligible: false,
      reason: 'build-attestation-invalid',
      reuse: false,
    });
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        buildFiles: [
          {
            content: attestation.replace(`pull_request=${pullRequest}`, 'pull_request=244'),
            path: 'relay-pr-provenance.txt',
          },
        ],
      }),
    ).toMatchObject({ eligible: false, reason: 'build-attestation-invalid', reuse: false });
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        buildFiles: [...validInput.buildFiles, { content: 'extra', path: 'response-body.txt' }],
      }),
    ).toMatchObject({ eligible: false, reason: 'build-attestation-invalid', reuse: false });
  });

  it('requires exactly the unit and renderer LCOV members', () => {
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        coverageFiles: validInput.coverageFiles.slice(0, 1),
      }),
    ).toMatchObject({ eligible: false, reason: 'coverage-members-invalid', reuse: false });
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        coverageFiles: [
          ...validInput.coverageFiles,
          { content: unitLcov, path: 'extra/lcov.info' },
        ],
      }),
    ).toMatchObject({ eligible: false, reason: 'coverage-members-invalid', reuse: false });
  });

  it('accepts a renderer tracefile with covered code and a valid zero-line CSS source', () => {
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        coverageFiles: [
          validInput.coverageFiles[0],
          { content: `${rendererLcov}${zeroLineCssRecord}`, path: 'renderer/lcov.info' },
        ],
      }),
    ).toEqual({ eligible: true, mode: 'enabled', reason: 'eligible', reuse: true });
  });

  it('rejects no-DA records with missing, nonzero, or incompatible line summaries', () => {
    for (const invalidRecord of [
      'TN:\nSF:src/renderer/missing.css\nend_of_record\n',
      'TN:\nSF:src/renderer/nonzero.css\nLF:1\nLH:0\nend_of_record\n',
      'TN:\nSF:src/renderer/incompatible.css\nLF:0\nLH:1\nend_of_record\n',
    ]) {
      expect(
        evaluateReuseArtifacts({
          ...validInput,
          coverageFiles: [
            validInput.coverageFiles[0],
            { content: `${rendererLcov}${invalidRecord}`, path: 'renderer/lcov.info' },
          ],
        }),
      ).toMatchObject({ eligible: false, reason: 'coverage-format-invalid', reuse: false });
    }
  });

  it('rejects a renderer tracefile made entirely of zero-line sources', () => {
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        coverageFiles: [
          validInput.coverageFiles[0],
          { content: zeroLineCssRecord, path: 'renderer/lcov.info' },
        ],
      }),
    ).toMatchObject({ eligible: false, reason: 'coverage-format-invalid', reuse: false });
  });

  it('rejects empty, oversized, binary, and malformed LCOV text', () => {
    for (const content of [
      '',
      'not lcov',
      'SF:src/unit.ts\nDA:1,1\n',
      'SF:src/unit.ts\nDA:not-a-record\nend_of_record\n',
      `${unitLcov}private response body\n`,
      `SF:src/unit.ts\nDA:1,1\nend_of_record\n\u0000private`,
    ]) {
      expect(
        evaluateReuseArtifacts({
          ...validInput,
          coverageFiles: [{ content, path: 'unit/lcov.info' }, validInput.coverageFiles[1]],
        }),
      ).toMatchObject({ eligible: false, reuse: false });
    }
    expect(
      evaluateReuseArtifacts({
        ...validInput,
        coverageFiles: [
          { content: 'x'.repeat(16 * 1024 * 1024 + 1), path: 'unit/lcov.info' },
          validInput.coverageFiles[1],
        ],
      }),
    ).toMatchObject({ eligible: false, reason: 'coverage-content-invalid', reuse: false });
  });
});

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const createCliFixture = async (overrides = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'relay-ci-reuse-validation-'));
  temporaryDirectories.push(directory);
  const buildDirectory = join(directory, 'build');
  const coverageDirectory = join(directory, 'coverage');
  await mkdir(join(coverageDirectory, 'unit'), { recursive: true });
  await mkdir(join(coverageDirectory, 'renderer'), { recursive: true });
  await mkdir(buildDirectory, { recursive: true });
  await writeFile(join(buildDirectory, 'relay-pr-provenance.txt'), attestation, 'utf8');
  await writeFile(join(coverageDirectory, 'unit/lcov.info'), unitLcov, 'utf8');
  await writeFile(join(coverageDirectory, 'renderer/lcov.info'), rendererLcov, 'utf8');

  return {
    BASE_SHA: baseSha,
    BUILD_ARTIFACT_DIRECTORY: buildDirectory,
    BUILD_DOWNLOAD_OUTCOME: 'success',
    COVERAGE_ARTIFACT_DIRECTORY: coverageDirectory,
    COVERAGE_DOWNLOAD_OUTCOME: 'success',
    GITHUB_OUTPUT: join(directory, 'github-output'),
    GITHUB_STEP_SUMMARY: join(directory, 'github-summary'),
    HEAD_SHA: headSha,
    METADATA_ELIGIBLE: 'true',
    METADATA_REASON: 'eligible',
    PULL_REQUEST: pullRequest,
    RELAY_CI_TREE_REUSE_MODE: 'enabled',
    ...overrides,
  };
};

describe('runCiReuseArtifactValidation', () => {
  it('writes only final payload-backed outputs and a sanitized summary', async () => {
    const env = await createCliFixture();

    await expect(runCiReuseArtifactValidation({ env })).resolves.toEqual({
      eligible: true,
      mode: 'enabled',
      reason: 'eligible',
      reuse: true,
    });
    expect(await readFile(env.GITHUB_OUTPUT, 'utf8')).toBe(
      'eligible=true\nreuse=true\nreason=eligible\n',
    );
    expect(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8')).toBe(
      [
        '### CI tree reuse provenance',
        '',
        '- Mode: `enabled`',
        '- Metadata eligible: `true`',
        '- Final eligible: `true`',
        '- Reuse: `true`',
        '- Reason: `eligible`',
        '',
      ].join('\n'),
    );
  });

  it('fails closed without disclosing raw modes, reasons, file contents, paths, or errors', async () => {
    const secret = 'private-token-and-response-body';
    const env = await createCliFixture({
      BUILD_ARTIFACT_DIRECTORY: `/missing/${secret}`,
      BUILD_DOWNLOAD_OUTCOME: 'failure',
      METADATA_REASON: `unsafe\n${secret}`,
      RELAY_CI_TREE_REUSE_MODE: secret,
    });

    const result = await runCiReuseArtifactValidation({ env });
    const output = await readFile(env.GITHUB_OUTPUT, 'utf8');
    const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');

    expect(result).toMatchObject({
      eligible: false,
      mode: 'shadow',
      reason: 'metadata-invalid',
      reuse: false,
    });
    expect(`${output}\n${summary}`).not.toContain(secret);
    expect(summary).not.toContain('/missing/');
    expect(summary).toContain('- Mode: `shadow`');
    expect(summary).toContain('- Reason: `metadata-invalid`');
  });
});
