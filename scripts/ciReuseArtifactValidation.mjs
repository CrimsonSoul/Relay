import { appendFile, lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ID_PATTERN = /^[1-9]\d*$/u;
const REASON_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const BUILD_ATTESTATION_NAME = 'relay-pr-provenance.txt';
const COVERAGE_MEMBERS = ['renderer/lcov.info', 'unit/lcov.info'];
const MAX_BUILD_BYTES = 4 * 1024;
const MAX_LCOV_BYTES = 16 * 1024 * 1024;

const sanitizedMode = (mode) => (mode === 'enabled' ? 'enabled' : 'shadow');
const sanitizedReason = (reason, fallback) =>
  typeof reason === 'string' && REASON_PATTERN.test(reason) ? reason : fallback;
const byteLength = (text) => Buffer.byteLength(text, 'utf8');
const containsControlCharacter = (text) =>
  [...text].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });

const result = (mode, eligible, reuse, reason) => ({
  eligible,
  mode: sanitizedMode(mode),
  reason,
  reuse,
});

function validMetadataIdentity(input) {
  if (
    typeof input.pullRequest !== 'string' ||
    !ID_PATTERN.test(input.pullRequest) ||
    !Number.isSafeInteger(Number(input.pullRequest)) ||
    typeof input.baseSha !== 'string' ||
    !SHA_PATTERN.test(input.baseSha) ||
    typeof input.headSha !== 'string' ||
    !SHA_PATTERN.test(input.headSha)
  ) {
    return false;
  }
  return input.metadataReason === 'eligible';
}

function validAttestation(input) {
  if (!Array.isArray(input.buildFiles) || input.buildFiles.length !== 1) return false;
  const [file] = input.buildFiles;
  if (
    file?.path !== BUILD_ATTESTATION_NAME ||
    typeof file.content !== 'string' ||
    byteLength(file.content) === 0 ||
    byteLength(file.content) > MAX_BUILD_BYTES ||
    file.content.includes('\u0000') ||
    file.content.includes('\uFFFD')
  ) {
    return false;
  }
  return (
    file.content ===
    `pull_request=${input.pullRequest}\nbase_sha=${input.baseSha}\nhead_sha=${input.headSha}\n`
  );
}

function openLcovSource(payload, state) {
  if (state.sourceOpen || payload.length === 0 || containsControlCharacter(payload)) return false;
  state.sourceOpen = true;
  state.sourceHasData = false;
  state.sourceLineFound = null;
  state.sourceLineHit = null;
  state.sourceSummaryCompatible = true;
  state.sourceSummaryTags = new Set();
  state.testNamePending = false;
  return true;
}

function recordLcovData(payload, state) {
  if (
    !state.sourceOpen ||
    !/^[1-9]\d*,\d+(?:,[^,\r\n]+)?$/u.test(payload) ||
    containsControlCharacter(payload)
  ) {
    return false;
  }
  state.sourceHasData = true;
  state.dataRecords += 1;
  return true;
}

function closeLcovSource(state) {
  const validZeroLineSource =
    state.sourceLineFound === 0 &&
    state.sourceLineHit === 0 &&
    state.sourceSummaryCompatible === true;
  if (!state.sourceOpen || (!state.sourceHasData && !validZeroLineSource)) return false;
  state.sourceOpen = false;
  state.sourceHasData = false;
  state.records += 1;
  return true;
}

function validNamedLcovRecord(line, pattern) {
  const match = pattern.exec(line);
  return match !== null && !containsControlCharacter(match[1]);
}

function recordLcovSummary(line, state) {
  const match = /^(FNF|FNH|BRF|BRH|LF|LH):(\d+)$/u.exec(line);
  if (match === null) return null;
  const [, tag, rawValue] = match;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || state.sourceSummaryTags.has(tag)) return false;
  state.sourceSummaryTags.add(tag);
  if (tag === 'LF') state.sourceLineFound = value;
  if (tag === 'LH') state.sourceLineHit = value;
  if (value !== 0) state.sourceSummaryCompatible = false;
  return true;
}

function validSemanticLcovRecord(line) {
  return (
    /^BRDA:[1-9]\d*,\d+,\d+,(?:\d+|-)$/u.test(line) ||
    validNamedLcovRecord(line, /^FN:\d+(?:,\d+)?,(.+)$/u) ||
    validNamedLcovRecord(line, /^FNDA:\d+,(.+)$/u)
  );
}

function validSupplementalLcovRecord(line, state) {
  const summary = recordLcovSummary(line, state);
  if (summary !== null) return summary;
  if (validSemanticLcovRecord(line)) {
    state.sourceSummaryCompatible = false;
    return true;
  }
  return validNamedLcovRecord(line, /^VER:(.+)$/u);
}

function openLcovTestName(payload, state) {
  if (state.sourceOpen || state.testNamePending || containsControlCharacter(payload)) return false;
  state.testNamePending = true;
  return true;
}

function validLcovLine(line, state) {
  if (line.length === 0) return true;
  if (line === 'end_of_record') return closeLcovSource(state);
  const separator = line.indexOf(':');
  if (separator < 0) return false;
  const tag = line.slice(0, separator);
  const payload = line.slice(separator + 1);
  if (tag === 'SF') return openLcovSource(payload, state);
  if (tag === 'DA') return recordLcovData(payload, state);
  if (tag === 'TN') return openLcovTestName(payload, state);
  return state.sourceOpen && validSupplementalLcovRecord(line, state);
}

function validLcov(text) {
  if (
    typeof text !== 'string' ||
    byteLength(text) === 0 ||
    byteLength(text) > MAX_LCOV_BYTES ||
    text.includes('\u0000') ||
    text.includes('\uFFFD')
  ) {
    return false;
  }

  const state = {
    dataRecords: 0,
    records: 0,
    sourceHasData: false,
    sourceLineFound: null,
    sourceLineHit: null,
    sourceOpen: false,
    sourceSummaryCompatible: false,
    sourceSummaryTags: new Set(),
    testNamePending: false,
  };
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  return (
    lines.every((line) => validLcovLine(line, state)) &&
    state.records > 0 &&
    state.dataRecords > 0 &&
    !state.sourceOpen &&
    !state.testNamePending
  );
}

function coverageFailureReason(files) {
  if (!Array.isArray(files) || files.length !== COVERAGE_MEMBERS.length) {
    return 'coverage-members-invalid';
  }
  const paths = files
    .map((file) => file?.path)
    .sort((left, right) => String(left).localeCompare(String(right), 'en'));
  if (paths.some((path, index) => path !== COVERAGE_MEMBERS[index])) {
    return 'coverage-members-invalid';
  }
  for (const file of files) {
    if (
      typeof file.content !== 'string' ||
      byteLength(file.content) === 0 ||
      byteLength(file.content) > MAX_LCOV_BYTES ||
      file.content.includes('\u0000') ||
      file.content.includes('\uFFFD')
    ) {
      return 'coverage-content-invalid';
    }
    if (!validLcov(file.content)) return 'coverage-format-invalid';
  }
  return null;
}

export function evaluateReuseArtifacts(input) {
  const mode = sanitizedMode(input?.mode);
  if (input?.metadataEligible !== true) {
    const reason = sanitizedReason(input?.metadataReason, 'metadata-ineligible');
    return result(mode, false, false, reason === 'eligible' ? 'metadata-ineligible' : reason);
  }
  if (!validMetadataIdentity(input)) return result(mode, false, false, 'metadata-invalid');
  if (input.buildDownloadOutcome !== 'success') {
    return result(mode, false, false, 'build-download-failed');
  }
  if (input.coverageDownloadOutcome !== 'success') {
    return result(mode, false, false, 'coverage-download-failed');
  }
  if (!validAttestation(input)) return result(mode, false, false, 'build-attestation-invalid');
  const coverageReason = coverageFailureReason(input.coverageFiles);
  if (coverageReason !== null) return result(mode, false, false, coverageReason);
  return result(mode, true, mode === 'enabled', 'eligible');
}

async function collectFiles(directory, { allowedDirectories, maxBytes, maxFiles }) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('artifact-invalid');
  const files = [];

  async function visit(currentDirectory, prefix) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(currentDirectory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error('artifact-invalid');
      if (metadata.isDirectory()) {
        if (!allowedDirectories.has(relativePath)) throw new Error('artifact-invalid');
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) {
        throw new Error('artifact-invalid');
      }
      files.push({ content: await readFile(absolutePath, 'utf8'), path: relativePath });
      if (files.length > maxFiles) throw new Error('artifact-invalid');
    }
  }

  await visit(directory, '');
  return files;
}

const fallbackResult = (env, reason) => result(env.RELAY_CI_TREE_REUSE_MODE, false, false, reason);

async function evaluateFromFilesystem(env) {
  const input = {
    baseSha: env.BASE_SHA,
    buildDownloadOutcome: env.BUILD_DOWNLOAD_OUTCOME,
    buildFiles: [],
    coverageDownloadOutcome: env.COVERAGE_DOWNLOAD_OUTCOME,
    coverageFiles: [],
    headSha: env.HEAD_SHA,
    metadataEligible: env.METADATA_ELIGIBLE === 'true',
    metadataReason: env.METADATA_REASON,
    mode: env.RELAY_CI_TREE_REUSE_MODE,
    pullRequest: env.PULL_REQUEST,
  };

  const preflight = evaluateReuseArtifacts(input);
  if (
    input.metadataEligible !== true ||
    preflight.reason === 'metadata-invalid' ||
    preflight.reason.endsWith('-download-failed')
  ) {
    return preflight;
  }

  try {
    input.buildFiles = await collectFiles(env.BUILD_ARTIFACT_DIRECTORY, {
      allowedDirectories: new Set(),
      maxBytes: MAX_BUILD_BYTES,
      maxFiles: 1,
    });
  } catch {
    return fallbackResult(env, 'build-attestation-invalid');
  }
  try {
    input.coverageFiles = await collectFiles(env.COVERAGE_ARTIFACT_DIRECTORY, {
      allowedDirectories: new Set(['renderer', 'unit']),
      maxBytes: MAX_LCOV_BYTES,
      maxFiles: COVERAGE_MEMBERS.length,
    });
  } catch {
    return fallbackResult(env, 'coverage-members-invalid');
  }
  return evaluateReuseArtifacts(input);
}

async function writeOutputs(outputPath, validation) {
  await appendFile(
    outputPath,
    `eligible=${validation.eligible ? 'true' : 'false'}\nreuse=${validation.reuse ? 'true' : 'false'}\nreason=${validation.reason}\n`,
    'utf8',
  );
}

async function writeSummary(summaryPath, env, validation) {
  const metadataEligible = env.METADATA_ELIGIBLE === 'true';
  const summary = [
    '### CI tree reuse provenance',
    '',
    `- Mode: \`${validation.mode}\``,
    `- Metadata eligible: \`${metadataEligible ? 'true' : 'false'}\``,
    `- Final eligible: \`${validation.eligible ? 'true' : 'false'}\``,
    `- Reuse: \`${validation.reuse ? 'true' : 'false'}\``,
    `- Reason: \`${validation.reason}\``,
    '',
  ].join('\n');
  await appendFile(summaryPath, summary, 'utf8');
}

export async function runCiReuseArtifactValidation({ env = process.env } = {}) {
  const validation = await evaluateFromFilesystem(env);
  await writeOutputs(env.GITHUB_OUTPUT, validation);
  await writeSummary(env.GITHUB_STEP_SUMMARY, env, validation);
  return validation;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCiReuseArtifactValidation().catch(() => {
    process.stderr.write('CI tree reuse artifact validation failed.\n');
    process.exitCode = 1;
  });
}
