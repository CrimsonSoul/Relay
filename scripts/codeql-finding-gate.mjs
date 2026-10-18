import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Matches the Snyk high-severity threshold: CodeQL maps security-severity >= 7.0 to High/Critical.
export const BLOCKING_SECURITY_SEVERITY = 7;
// Fixed workspace-relative output of the analyze step, never taken from the command line.
export const SARIF_DIRECTORY = 'codeql-results';

function ruleProperties(run, ruleId) {
  const components = [run?.tool?.driver, ...(run?.tool?.extensions ?? [])];
  for (const component of components) {
    const rule = component?.rules?.find((candidate) => candidate?.id === ruleId);
    if (rule) return rule.properties ?? {};
  }
  return {};
}

function isSuppressed(result) {
  return (result.suppressions ?? []).some((suppression) => suppression?.status !== 'rejected');
}

function resultLocation(result) {
  const physical = result.locations?.[0]?.physicalLocation;
  const path = physical?.artifactLocation?.uri ?? '<unknown>';
  const line = physical?.region?.startLine;
  return line ? `${path}:${line}` : path;
}

function blockingFinding(run, result) {
  if (isSuppressed(result) || result.baselineState === 'absent') return null;
  const severity = Number.parseFloat(ruleProperties(run, result.ruleId)['security-severity']);
  const hasSeverity = Number.isFinite(severity);
  const blocking = hasSeverity ? severity >= BLOCKING_SECURITY_SEVERITY : result.level === 'error';
  if (!blocking) return null;
  return {
    ruleId: result.ruleId ?? '<unknown>',
    severity: hasSeverity ? severity : null,
    location: resultLocation(result),
    message: result.message?.text ?? '',
  };
}

export function blockingCodeqlFindings(sarifDocuments) {
  return sarifDocuments
    .flatMap((sarif) => sarif?.runs ?? [])
    .flatMap((run) => (run.results ?? []).map((result) => blockingFinding(run, result)))
    .filter((finding) => finding !== null);
}

export function readSarifDirectory(directory) {
  const files = readdirSync(directory).filter((name) => name.endsWith('.sarif'));
  if (files.length === 0) {
    throw new Error(`No CodeQL SARIF output found in ${directory}.`);
  }
  return files.map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));
}

function main() {
  const directory = SARIF_DIRECTORY;
  let documents;
  try {
    documents = readSarifDirectory(directory);
  } catch (error) {
    console.error(`CodeQL gate configuration error: ${error.message}`);
    return 2;
  }
  const findings = blockingCodeqlFindings(documents);
  if (findings.length === 0) {
    console.log('CodeQL gate clean: no high or critical findings.');
    return 0;
  }
  console.error(`CodeQL gate found ${findings.length} high or critical finding(s):`);
  for (const finding of findings) {
    const severity = finding.severity === null ? 'error' : finding.severity.toFixed(1);
    console.error(`- [${severity}] ${finding.ruleId} at ${finding.location}: ${finding.message}`);
    console.log(`::error title=CodeQL ${finding.ruleId}::${finding.location}`);
  }
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main();
}
