import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const read = (path) => readFileSync(path, 'utf8');
const readWorkflow = (path) => parse(read(path));
const findStep = (job, name) => job.steps.find((step) => step.name === name);

describe('Windows NSIS launcher contract', () => {
  it('keeps launcher state path-based and protocol-versioned', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain('!define RELAY_RUNTIME_ROOT "$LOCALAPPDATA\\Relay"');
    expect(source).toContain('$RelayRoot\\state.ini');
    expect(source).toContain('"Relay" "protocol"');
    expect(contract).toContain('--relay-launcher-probe');
    expect(contract).toContain('.relay-runtime-ready');
    expect(source).not.toMatch(/ReadINIStr[^\n]+state\.ini[^\n]+(?:path|executable)/i);
  });

  it('tries current before retained predecessors and forwards the untouched parameter string', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source.indexOf('"Relay" "current"')).toBeLessThan(source.indexOf('"Relay" "previous0"'));
    expect(source.indexOf('"Relay" "previous0"')).toBeLessThan(
      source.indexOf('"Relay" "previous1"'),
    );
    expect(source.indexOf('"Relay" "previous1"')).toBeLessThan(
      source.indexOf('"Relay" "previous2"'),
    );
    expect(source).toContain('${GetParameters} $RelayArgs');
    expect(source).toContain('Exec \'"$RelayExecutable" $RelayArgs\'');
  });

  it('opens a retained recovery runtime when protocol-2 current cannot launch', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const protocol2 = source.slice(source.indexOf('ReadINIStr $RelayPrevious0'));
    const currentLaunch = protocol2.indexOf('!insertmacro RelayTryRuntime "$RelayBuildId"');
    const fallbackLaunch = protocol2.indexOf(
      '!insertmacro RelayTryRecoveryRuntime "$RelayPrevious0"',
      currentLaunch,
    );

    expect(currentLaunch).toBeGreaterThan(-1);
    expect(fallbackLaunch).toBeGreaterThan(currentLaunch);
    expect(
      protocol2.indexOf('!insertmacro RelayTryRecoveryRuntime "$RelayPrevious0"'),
    ).toBeLessThan(protocol2.indexOf('!insertmacro RelayTryRecoveryRuntime "$RelayCurrent"'));
  });

  it('supervises a protocol-2 candidate twice and promotes it only after a matching health receipt', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');
    const timing = JSON.parse(read('build/windows/recovery-timing.json'));

    expect(source).toContain('$RelayRoot\\Recovery\\prepared.ini');
    expect(source).toContain('$RelayRoot\\Recovery\\probation-result.ini');
    expect(source).toContain('"Relay" "candidate"');
    expect(source).toContain('"Transaction" "attempts"');
    expect(contract).toContain('--relay-recovery-probation=');
    expect(source).toContain('Function RelayRunProbation');
    expect(source).toContain('CreateProcessW');
    expect(source).toContain('WaitForSingleObject');
    expect(source).toContain('${RELAY_PROBATION_SUPERVISOR_TIMEOUT_MS}');
    expect(source).not.toContain('130000');
    expect(timing.supervisorTimeoutMs).toBeGreaterThanOrEqual(
      timing.startupDeadlineMs + timing.probationDurationMs + timing.shutdownOverheadMs,
    );
    expect(source).toContain('TerminateProcess');
    expect(source).toContain('$RelayProbationAttempts >= 2');
    expect(source).toContain('PromoteCandidate:');
    expect(source).toContain('RollbackCandidate:');
    expect(source).toContain(
      'ReadINIStr $RelayPreparedCommit "$RelayState" "Build.$RelayCandidate" "targetCommitish"',
    );
    expect(source).toContain(
      'StrCpy $RelayFailedFingerprint "$RelayPreparedReleaseTag@$RelayPreparedCommit"',
    );
    expect(source).toContain('MoveFileExW');
  });

  it('serializes launcher supervision and exposes a native recovery entry point', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain('launcher.lock');
    expect(source).toContain('ERROR_SHARING_VIOLATION');
    expect(contract).toContain('/relay-recovery');
    expect(contract).toContain('--relay-recovery-center');
    expect(contract).toContain('https://github.com/CrimsonSoul/Relay/releases');
  });

  it('restores a validated stopped server snapshot through an idempotent data journal', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('Function RelayRestoreServerSnapshot');
    expect(source).toContain('$APPDATA\\Relay\\recovery-rollback.ini');
    expect(source).toContain('$APPDATA\\Relay\\RecoverySnapshots\\$RelayTransactionSnapshot');
    expect(source).toContain('"Snapshot" "complete"');
    expect(source).toContain('"Snapshot" "transactionId"');
    expect(source).toContain('Rename "$RelayLiveData" "$RelayFailedData"');
    expect(source).toContain('Rename "$RelaySnapshotRoot\\data" "$RelayLiveData"');
    expect(source).toContain('Rename "$RelayFailedData" "$RelayLiveData"');
    expect(source.indexOf('Call RelayRestoreServerSnapshot')).toBeLessThan(
      source.indexOf(
        'DeleteINISec "$RelayStateNew" "Transaction"',
        source.indexOf('RollbackCandidate:'),
      ),
    );
  });

  it('accepts a manual rollback only to one compatible retained build', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('$RelayRoot\\Recovery\\rollback-request.ini');
    expect(source).toContain('HandleManualRollback:');
    expect(source).toContain('"RollbackRequest" "targetBuildId"');
    expect(source).toContain('$RelayManualTarget == "$RelayPrevious0"');
    expect(source).toContain('$RelayManualTarget == "$RelayPrevious1"');
    expect(source).toContain('$RelayManualTarget == "$RelayPrevious2"');
    expect(source).toContain('"Build.$RelayManualTarget" "health"');
    expect(source).toContain('"Build.$RelayManualTarget" "serverDataEpoch"');
    expect(source).toContain('"Build.$RelayManualTarget" "clientDataEpoch"');
    expect(source).toContain('StrCpy $RelayExpectedSnapshotTransaction $RelaySnapshotTransaction');
    expect(source).toContain('$RelaySnapshotTransaction != "$RelayExpectedSnapshotTransaction"');
    expect(source).toContain('WriteINIStr "$RelayStateNew" "Relay" "current" "$RelayManualTarget"');
    expect(source.match(/\$\{If\} \$\{FileExists\} "\$RelayRollbackRequest"/g)).toHaveLength(1);
  });

  it('validates build IDs before constructing fixed runtime candidates', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain('!insertmacro RelayValidateBuildId');
    expect(source).toContain('$RelayRoot\\Runtime\\${BUILD_ID}');
    expect(source).toContain('$RelayRuntimeDir\\${RELAY_INNER_EXECUTABLE}');
    expect(contract).toContain('abcdefghijklmnopqrstuvwxyz0123456789._-');
    expect(contract).toContain('abcdefghijklmnopqrstuvwxyz0123456789"');
    expect(contract).toContain('StrCpy $RelayContractFirst "${VALUE}" 1');
    expect(contract).toContain('StrCpy $RelayContractLast "${VALUE}" 1 -1');
    expect(contract).toContain('${WordFind} "${VALUE}" "." "+1" $RelayContractBase');
    expect(contract).toContain('StrCpy $RelayContractBase "${VALUE}"');
    expect(contract).toContain('$RelayContractBase == "con"');
    expect(contract).toContain('$RelayContractDevicePrefix == "com"');
    expect(contract).toContain('$RelayContractFirstFiltered == $RelayContractFirst');
    expect(contract).toContain('${If} $RelayContractLength > 64');
  });

  it('binds every protocol-2 runtime marker to its catalog identity before launch', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(source).toContain(
      'ReadINIStr $RelayCatalogRuntimeHash "$RelayState" "Build.${BUILD_ID}" "runtimeSha512"',
    );
    expect(source).toContain('$RelayMarkerHash == $RelayCatalogRuntimeHash');
    expect(source).toContain('$RelayMarkerVersion == $RelayCatalogVersion');
    expect(source).toContain('$RelayMarkerCommit == $RelayCatalogCommit');
    expect(source).toContain('$RelayMarkerServerEpoch == $RelayCatalogServerEpoch');
    expect(source).toContain('$RelayMarkerClientEpoch == $RelayCatalogClientEpoch');
    expect(source).toContain('$RelayCatalogHealth == "healthy"');
    expect(source).toContain('$RelayCatalogHealth == "candidate"');
    expect(source).toContain('$RelayPreparedBuild == "${BUILD_ID}"');
    expect(source).toContain('$RelayMarkerHash == $RelayPreparedRuntimeHash');
    expect(source).toContain('!insertmacro RelayVerifyRuntimeContent');
    expect(contract).toContain('resources\\app.asar');
    expect(contract).toContain('resources\\pocketbase\\win32-x64\\pocketbase.exe');
    expect(contract).toContain('resources\\pocketbase\\hooks\\relay_privileged_reauth.pb.js');
    expect(contract).toContain('better-sqlite3\\build\\Release\\better_sqlite3.node');
    expect(contract).toContain('@koromix\\koffi-win32-x64\\win32_x64\\koffi.node');
    for (const runtimeDll of [
      'd3dcompiler_47.dll',
      'dxcompiler.dll',
      'dxil.dll',
      'ffmpeg.dll',
      'libEGL.dll',
      'libGLESv2.dll',
      'vk_swiftshader.dll',
      'vulkan-1.dll',
    ]) {
      expect(contract).toContain(runtimeDll);
    }
    expect(contract.match(/StdUtils\.HashFile/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('reconciles transaction-bound update requests interrupted after either catalog commit', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const reconcileFunction = source.slice(
      source.indexOf('Function RelayReconcileSettledUpdateRequest'),
      source.indexOf('FunctionEnd', source.indexOf('Function RelayReconcileSettledUpdateRequest')),
    );
    const startupPaths = source.indexOf(
      'StrCpy $RelaySettlement "$RelayRoot\\Recovery\\settled-update.ini"',
    );
    const startupReconcile = source.indexOf(
      'Call RelayReconcileSettledUpdateRequest',
      startupPaths,
    );
    const startupDataCleanup = source.indexOf(
      'Call RelayCleanupCompletedServerRestore',
      startupPaths,
    );
    const promotion = source.slice(
      source.indexOf('PromoteCandidate:'),
      source.indexOf('RollbackCandidate:'),
    );
    const rollback = source.slice(
      source.indexOf('RollbackCandidate:'),
      source.indexOf('RejectPreparedCandidate:'),
    );
    const promotionCommit = promotion.indexOf('MoveFileExW');
    const promotionIntent = promotion.indexOf('Call RelayWriteSettlementIntent');
    const promotionReconcile = promotion.indexOf('Call RelayReconcileSettledUpdateRequest');
    const rollbackCommit = rollback.indexOf('MoveFileExW');
    const rollbackIntent = rollback.indexOf('Call RelayWriteSettlementIntent');
    const rollbackReconcile = rollback.indexOf('Call RelayReconcileSettledUpdateRequest');

    expect(reconcileFunction).toContain('$RelaySettlementTransaction != $RelayRequestTransaction');
    expect(reconcileFunction).toContain('$RelaySettlementSource != $RelaySourceBuild');
    expect(reconcileFunction).toContain('$RelayCatalogCurrent == $RelaySettlementTarget');
    expect(reconcileFunction).toContain('$RelayCatalogCurrent == $RelaySettlementSource');
    expect(reconcileFunction).toContain('$RelayCatalogCandidate != ""');
    expect(reconcileFunction).toContain('$RelayCatalogTransaction != ""');
    expect(reconcileFunction).toContain('$RelaySettlementOutcome == "promoted"');
    expect(reconcileFunction).toContain('$RelaySettlementOutcome == "rolled-back"');
    expect(reconcileFunction).toContain('Delete "$RelayRequest"');
    expect(reconcileFunction).toContain('Delete "$RelaySettlement"');
    expect(startupReconcile).toBeGreaterThan(startupPaths);
    expect(startupReconcile).toBeLessThan(startupDataCleanup);
    expect(promotionIntent).toBeGreaterThan(-1);
    expect(promotionIntent).toBeLessThan(promotionCommit);
    expect(promotionReconcile).toBeGreaterThan(promotionCommit);
    expect(rollbackIntent).toBeGreaterThan(-1);
    expect(rollbackIntent).toBeLessThan(rollbackCommit);
    expect(rollbackReconcile).toBeGreaterThan(rollbackCommit);
    expect(rollbackReconcile).toBeLessThan(rollback.indexOf('Call RelayFinalizeServerRestore'));
  });

  it('retains a bounded deduplicated history of failed immutable releases', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain(
      'ReadINIStr $RelayFailedFingerprints "$RelayState" "Relay" "failedReleaseFingerprints"',
    );
    expect(source).toContain('$RelayFailedFingerprintCount < 16');
    expect(source).toContain('$RelayExistingFingerprint != $RelayFailedFingerprint');
    expect(source).toContain(
      'WriteINIStr "$RelayStateNew" "Relay" "failedReleaseFingerprints" "$RelayNewFailedFingerprints"',
    );
  });

  it('removes displaced server data only after catalog activation and retries one journaled cleanup', () => {
    const source = read('build/windows/relay-launcher.nsi');
    const manualCommit = source.indexOf(
      'System::Call \'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0\'',
      source.indexOf('HandleManualRollback:'),
    );
    const manualFinalize = source.indexOf('Call RelayFinalizeServerRestore', manualCommit);

    expect(source).toContain('Function RelayFinalizeServerRestore');
    expect(source).toContain('Function RelayCleanupCompletedServerRestore');
    expect(source).toContain('RMDir /r "$RelayFailedData"');
    expect(source).toContain('$RelayRestoreJournalTransaction');
    expect(source).toContain(
      'WriteINIStr "$RelayRestoreJournal" "Restore" "expectedCurrentBuildId" "$RelayTransactionSource"',
    );
    expect(source).toContain('$RelayRestoreJournalExpectedCurrent != $RelayCatalogCurrent');
    expect(source).toContain('$RelayRestoreJournalPhase != "restored"');
    expect(manualFinalize).toBeGreaterThan(manualCommit);
    const startupCleanup = source.indexOf('Call RelayCleanupCompletedServerRestore');
    expect(startupCleanup).toBeLessThan(
      source.indexOf('ReadINIStr $RelayProtocol "$RelayState" "Relay" "protocol"', startupCleanup),
    );
  });

  it('uses the shared probation timing contract in the native supervisor', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('!ifndef RELAY_PROBATION_DURATION_MS');
    expect(source).toContain('$RelayResultDuration < ${RELAY_PROBATION_DURATION_MS}');
    expect(source).toContain(
      'WaitForSingleObject(p $RelayProbationProcessHandle, i ${RELAY_PROBATION_SUPERVISOR_TIMEOUT_MS})',
    );
  });

  it('requires a protocol-1 completion marker for the selected build', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"');
    expect(source).toContain('ReadINIStr $RelayMarkerBuildId "$RelayMarker" "Relay" "buildId"');
    expect(source).toContain(
      'ReadINIStr $RelayMarkerExecutable "$RelayMarker" "Relay" "executable"',
    );
    expect(source).toContain('$RelayMarkerProtocol == "${RELAY_LEGACY_STATE_PROTOCOL}"');
    expect(source).toContain('$RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"');
    expect(source).toContain('$RelayMarkerBuildId == "${BUILD_ID}"');
    expect(source).toContain('$RelayMarkerExecutable == "${RELAY_INNER_EXECUTABLE}"');
  });

  it('is a non-elevating native handoff rather than another extractor', () => {
    const source = read('build/windows/relay-launcher.nsi');

    expect(source).toContain('RequestExecutionLevel user');
    expect(source).toContain('SilentInstall silent');
    expect(source).not.toMatch(/File \/r|nsisunz|Nsis7z|WriteReg|WriteUninstaller/);
    expect(source).toContain('CreateProcessW');
  });
});

describe('Windows NSIS bootstrap contract', () => {
  it('stages before atomically activating and writes readiness last', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('.staging-');
    expect(source.indexOf('Nsis7z::Extract')).toBeGreaterThan(-1);
    expect(source.indexOf('Nsis7z::Extract')).toBeLessThan(
      source.indexOf('WriteINIStr "$RelayMarker"'),
    );
    expect(source.indexOf('WriteINIStr "$RelayMarker"')).toBeLessThan(
      source.indexOf('MoveFileExW'),
    );
    expect(source).toContain('WriteINIStr "$RelayStateNew" "Relay" "current"');
    expect(source).toContain('WriteINIStr "$RelayStateNew" "Relay" "previous"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Relay" "executable"');
    expect(source).toContain('ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"');
    expect(source).toContain('CreateDirectoryW');
    expect(source).not.toContain('RMDir /r "$RelayStaging"');
    expect(source).not.toContain('RMDir /r "$RelayFinalRuntime"');
  });

  it('binds an in-app preparation to matching recovery metadata without promoting it', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(contract).toContain('RELAY_LEGACY_STATE_PROTOCOL "1"');
    expect(contract).toContain('RELAY_RECOVERY_STATE_PROTOCOL "2"');
    expect(source).toContain('${GetOptions} "$RelayArgs" "/relay-transaction="');
    expect(source).toContain('!insertmacro RelayValidateTransactionId');
    expect(source).toContain('$RelayRecoveryRoot\\update-request.ini');
    expect(source).toContain('$RelayRecoveryRoot\\prepared.ini.new');
    expect(source).toContain('targetCommitish');
    expect(source).toContain('${RELAY_TARGET_COMMITISH}');
    expect(source).toContain('${RELAY_SERVER_DATA_EPOCH}');
    expect(source).toContain('${RELAY_CLIENT_DATA_EPOCH}');
    expect(source).toContain('WritePreparedReceipt:');
    expect(source).toContain('MoveFileExW');
  });

  it('repairs only an exact retained build without changing the active catalog', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');

    expect(contract).toContain('RELAY_REPAIR_ONLY_ARGUMENT "/relay-repair-only"');
    expect(source).toContain('$RelayRecoveryRoot\\repair-request.ini');
    expect(source).toContain('$RelayRecoveryRoot\\repair-result.ini.new');
    expect(source).toContain('"RepairRequest" "targetBuildId"');
    expect(source).toContain('$RelayRepairTarget == "$RelayPrevious"');
    expect(source).toContain('$RelayRepairTarget == "$RelayPrevious1"');
    expect(source).toContain('$RelayRepairTarget == "$RelayPrevious2"');
    expect(source).toContain('"Build.$RelayRepairTarget" "targetCommitish"');
    expect(source).toContain('$RelayRepairCatalogRuntimeHash != $RelayMarkerHash');
    expect(source).toContain('$RelayRepairInstallerHash != "$RelaySelfHash"');
    expect(source).toContain('WriteRepairReceipt:');
    expect(source).toContain('"RepairResult" "runtimeSha512" "$RelayMarkerHash"');
    expect(source.indexOf('Goto WriteRepairReceipt')).toBeLessThan(
      source.indexOf('Relay could not prepare its stable launcher.'),
    );
    const receipt = source.slice(
      source.indexOf('WriteRepairReceipt:'),
      source.indexOf('ShortcutsReady:'),
    );
    expect(receipt).not.toContain('WriteINIStr "$RelayStateNew"');
  });

  it('quarantines an incomplete build ID and restores it if activation fails', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('StrCpy $RelayQuarantine');
    expect(source).toContain('Rename "$RelayFinalRuntime" "$RelayQuarantine"');
    expect(source).toContain('Rename "$RelayQuarantine" "$RelayFinalRuntime"');
    expect(source.indexOf('Rename "$RelayFinalRuntime" "$RelayQuarantine"')).toBeLessThan(
      source.indexOf('Rename "$RelayStaging" "$RelayFinalRuntime"'),
    );
    expect(source).not.toContain('referenced runtime that could not be safely replaced');
    expect(source).not.toContain('RMDir /r "$RelayFinalRuntime"');
  });

  it('timestamps new quarantines and refuses to abandon one without a creation marker', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const renameIndex = source.indexOf('Rename "$RelayFinalRuntime" "$RelayQuarantine"');
    const markerIndex = source.indexOf('$RelayQuarantine\\.relay-quarantine-created');

    expect(renameIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeGreaterThan(renameIndex);
    expect(source).toContain('FileOpen $RelayQuarantineMarkerHandle');
    expect(source).toContain('Rename "$RelayQuarantine" "$RelayFinalRuntime"');
    expect(source).toContain('Relay could not mark its damaged runtime quarantine.');
  });

  it('verifies the embedded runtime archive before extracting it', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const hashIndex = source.indexOf(
      '${StdUtils.HashFile} $RelayArchiveHash "SHA2-512" "$PLUGINSDIR\\relay-app.7z"',
    );
    const extractIndex = source.indexOf('Nsis7z::Extract');

    expect(source).toContain('!include "StdUtils.nsh"');
    expect(hashIndex).toBeGreaterThan(-1);
    expect(hashIndex).toBeLessThan(extractIndex);
    expect(source).toContain('$RelayArchiveHash != "${APP_64_HASH}"');
    expect(source).toContain('Relay could not verify the embedded runtime archive.');
    expect(source).toContain('SetOutPath "$RelayStaging"');
    expect(source).not.toContain('nsisunz::Unzip');
  });

  it('validates the extracted inner executable before writing readiness', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const binaryCheck = source.indexOf('GetBinaryTypeW');
    const markerWrite = source.indexOf('WriteINIStr "$RelayMarker"');

    expect(binaryCheck).toBeGreaterThan(-1);
    expect(binaryCheck).toBeLessThan(markerWrite);
    expect(source).toContain('The prepared Relay executable is not a valid Windows binary.');
    expect(source.match(/GetBinaryTypeW/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('records and revalidates content hashes for every critical runtime component', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const contract = read('build/windows/include/relay-runtime-contract.nsh');
    const smoke = read('scripts/windows-bootstrap-smoke.ps1');

    expect(source).toContain('WriteINIStr "$RelayMarker" "Integrity" "executableSha512"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Integrity" "appAsarSha512"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Integrity" "pocketbaseSha512"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Integrity" "pocketbaseHookSha512"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Integrity" "betterSqlite3Sha512"');
    expect(source).toContain('WriteINIStr "$RelayMarker" "Integrity" "koffiSha512"');
    for (const hashKey of [
      'd3dCompilerSha512',
      'dxCompilerSha512',
      'dxilSha512',
      'ffmpegSha512',
      'libEglSha512',
      'libGlesV2Sha512',
      'vkSwiftshaderSha512',
      'vulkanSha512',
    ]) {
      expect(source).toContain(`WriteINIStr "$RelayMarker" "Integrity" "${hashKey}"`);
    }
    expect(source).toContain('${StdUtils.HashFile} $RelayMarkerHash "SHA2-512" "$RelayMarker"');
    expect(source).toContain('"runtimeSha512" "$RelayMarkerHash"');
    expect(source).toContain('!insertmacro RelayVerifyRuntimeContent');
    expect(contract).toContain('!macro RelayVerifyRuntimeContent');
    expect(smoke).toContain("'ffmpeg.dll'");
    expect(smoke).toContain("'resources\\pocketbase\\hooks\\relay_privileged_reauth.pb.js'");
    expect(smoke).toContain('DllCorruptionRepaired = $true');
    expect(smoke).toContain('PocketBaseHookCorruptionRepaired = $true');
  });

  it('keeps the last usable fallback when the recorded current runtime is damaged', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const currentCheck = source.indexOf(
      '!insertmacro RelayRuntimeIsUsable "$RelayCurrent" $RelayRuntimeIsUsable',
    );
    const previousCheck = source.indexOf(
      '!insertmacro RelayRuntimeIsUsable "$RelayPrevious" $RelayRuntimeIsUsable',
    );
    const previousWrite = source.indexOf(
      'WriteINIStr "$RelayStateNew" "Relay" "previous" "$RelayFallbackBuild"',
    );

    expect(source).toContain('!macro RelayRuntimeIsUsable BUILD_ID RESULT');
    expect(currentCheck).toBeGreaterThan(-1);
    expect(previousCheck).toBeGreaterThan(currentCheck);
    expect(previousWrite).toBeGreaterThan(previousCheck);
    expect(source).not.toContain('WriteINIStr "$RelayStateNew" "Relay" "previous" "$RelayCurrent"');
  });

  it('requires a complete SHA-512 marker before retaining a fallback runtime', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source.match(/ReadINIStr \$RelayMarkerPayloadHash/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('StrLen $RelayPayloadHashLength $RelayMarkerPayloadHash');
    expect(source).toContain('$RelayPayloadHashLength == 128');
    expect(source).toContain('$RelayPayloadHashFiltered == $RelayMarkerPayloadHash');
  });

  it('maintains stable per-user shortcuts without installer state', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('$DESKTOP\\Relay.lnk');
    expect(source).toContain('$SMPROGRAMS\\Relay\\Relay.lnk');
    expect(source).toContain('$SMPROGRAMS\\Relay\\Relay Recovery.lnk');
    expect(source).toContain('${RELAY_RECOVERY_ARGUMENT}');
    expect(source.match(/CreateShortCut "\$DESKTOP\\Relay\.lnk"/g)).toHaveLength(1);
    expect(source).not.toContain('$COMMONDESKTOP');
    expect(source).toContain('!define RELAY_ROOT "$LOCALAPPDATA\\Relay"');
    expect(source).toContain('StrCpy $RelayLauncher "$RelayRoot\\Relay.exe"');
    expect(source).toContain('RequestExecutionLevel user');
    expect(source).not.toMatch(/WriteReg|WriteUninstaller|RequestExecutionLevel admin/);
  });

  it('serializes preparation and preserves the active runtime on failure', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('CreateFileW');
    expect(source).toContain('bootstrap.lock');
    expect(source).toContain('ERROR_SHARING_VIOLATION');
    expect(source).not.toContain('CreateMutexW');
    expect(source).not.toContain('Local\\RelayBootstrapProtocol1');
    expect(source).toContain('BootstrapFailed:');
    expect(source).not.toContain('RMDir /r "$RelayStaging"');
    expect(source.indexOf('BootstrapFailed:')).toBeLessThan(
      source.lastIndexOf('Exec \'"$RelayLauncher" $RelayArgs\''),
    );
    expect(source).toContain('FILE_ATTRIBUTE_REPARSE_POINT');
  });

  it('reports prepare-only lock contention as a failed preparation', () => {
    const source = read('build/windows/relay-bootstrap.nsi');
    const contentionStart = source.indexOf('BootstrapAlreadyRunning:');
    const contentionEnd = source.indexOf('BootstrapLockFailed:');
    const contention = source.slice(contentionStart, contentionEnd);

    expect(contentionStart).toBeGreaterThan(-1);
    expect(contentionEnd).toBeGreaterThan(contentionStart);
    expect(contention).toContain('${If} $RelayPrepareOnly == "/relay-prepare-only"');
    expect(contention).toContain('SetErrorLevel 1');
    expect(contention.indexOf('SetErrorLevel 1')).toBeLessThan(
      contention.indexOf('SetErrorLevel 0'),
    );
  });

  it('passes the launcher probe without adding quotes to the parsed argument', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('ExecWait \'"$RelayLauncher" ${RELAY_LAUNCHER_PROBE}\'');
    expect(source).toContain('ExecWait \'"$RelayLauncherNew" ${RELAY_LAUNCHER_PROBE}\'');
    expect(source).not.toContain('"${RELAY_LAUNCHER_PROBE}"');
  });

  it('supports a real preparation smoke mode without a redirectable production root', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain('/relay-prepare-only');
    expect(source).not.toMatch(/RELAY_TEST_ROOT|bootstrap-root|install-dir/i);
  });

  it('uses NSIS-native separators for compile-time project files', () => {
    const source = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain(
      '!include "${PROJECT_DIR}\\build\\windows\\include\\relay-runtime-contract.nsh"',
    );
    expect(source).toContain(
      '!include "${PROJECT_DIR}\\release\\windows-bootstrap\\relay-build.nsh"',
    );
    expect(source).not.toContain('${PROJECT_DIR}/');
  });

  it('smoke-tests first preparation, reuse, shortcuts, and data isolation', () => {
    const source = read('scripts/windows-bootstrap-smoke.ps1');
    const bootstrap = read('build/windows/relay-bootstrap.nsi');

    expect(source).toContain("-ArgumentList '/relay-prepare-only'");
    expect(source.match(/Invoke-RelayPreparation/g)).toHaveLength(10);
    expect(source).toContain('LastWriteTimeUtc.Ticks');
    expect(source).toContain("GetFolderPath('Desktop')");
    expect(source).toContain("GetFolderPath('StartMenu')");
    expect(source).toContain('Get-FileHash');
    expect(source).toContain('RELAY_BOOTSTRAP_SMOKE_CONFIRM');
    expect(source).toContain('[string]$PreviousArtifact');
    expect(source).toContain('[string]$ExpectedBuildId');
    expect(source).toContain('[string]$ExpectedPreviousBuildId');
    expect(source).toContain('[IO.FileShare]::Read');
    expect(source).toContain('ConcurrentPreparation');
    expect(source).toContain('Wait-BootstrapLockHeld');
    expect(source).toContain('DifferentBuildContentionRejected');
    expect(source).toContain(
      '$primaryPreviousProcess = Start-Process -FilePath $previousArtifactPath',
    );
    expect(source).toContain('$differentBuildContender = Start-Process -FilePath $artifactPath');
    expect(source).toContain('$differentBuildContender.ExitCode -eq 0');
    expect(source).not.toContain('$competingPreviousProcess');
    expect(source).toContain("Get-IniValue -Path $statePath -Key 'previous'");
    expect(source).toContain('verify-windows-pe.mjs');
    expect(source).toContain('[Diagnostics.Stopwatch]::StartNew()');
    expect(source).toContain('FirstPreparationMs');
    expect(source).toContain('ReusePreparationMs');
    expect(source).toContain('CorruptRuntimeRepaired');
    expect(source).toContain('Get-DirectoryTreeHash');
    expect(source).toContain('Wait-ProcessWithTimeout');
    expect(source).toContain('relay-build-id.txt');
    expect(source).toContain('BrokenCurrentPreservedPrevious');
    expect(source).toContain('ContentCorruptionRepaired');
    expect(source).toContain('resources\\app.asar');
    expect(source).toContain('actualCurrent=');
    expect(source).toContain('actualPrevious=');
    expect(bootstrap).toContain('$RelayRoot\\bootstrap-error.ini');
    expect(source).toContain('Relay bootstrap failure:');
  });

  it('compiles production boundary hooks only into an isolated harness root', () => {
    const bootstrap = read('build/windows/relay-bootstrap.nsi');
    const launcher = read('build/windows/relay-launcher.nsi');
    const harness = read('scripts/windows-bootstrap-boundary-smoke.ps1');

    expect(bootstrap).toContain('!ifdef RELAY_BOOTSTRAP_HARNESS');
    expect(bootstrap).toContain('.fail-after-extraction');
    expect(bootstrap).toContain('.fail-after-marker');
    expect(bootstrap).toContain('.fail-before-runtime-rename');
    expect(bootstrap).toContain('.fail-after-quarantine');
    expect(bootstrap).toContain('.fail-before-launcher-activation');
    expect(bootstrap).toContain('.fail-before-state-activation');
    expect(bootstrap).toContain('.fail-before-prepared-activation');
    expect(bootstrap).toContain('TerminateProcess');
    expect(launcher).toContain('RELAY_RUNTIME_ROOT');
    expect(harness).toContain('BoundaryFailuresPreservedFallback');
    expect(harness).toContain('Invoke-StableFallback');
    expect(harness).toContain('RELAY_BOOTSTRAP_BOUNDARY_CONFIRM');
    expect(harness).toContain("RELAY_DISABLE_CRASH_WATCHDOG = '1'");
    expect(harness).toContain('repair-restore-sentinel.txt');
    expect(harness).toContain('.fail-before-prepared-activation');
    expect(harness).toContain('New-RecoveryUpdateRequest');
    expect(harness).toContain('/relay-transaction=');
    expect(harness).toContain("'checkpoint=complete'");
    expect(harness).toContain('$process.ExitCode -ne 197');
    expect(harness).toContain('context=$Context');
    expect(harness).toContain('state=$stateSummary');
    expect(harness).toContain('Wait-ProcessWithTimeout');
    expect(harness).toContain('Wait-RelayRuntimeQuiescence');
    expect(harness).toContain('[StringComparison]::OrdinalIgnoreCase');
    expect(harness).toContain('Get-CimInstance Win32_Process');
    expect(harness).toContain("$bootstrapErrorPath = Join-Path $rootPath 'bootstrap-error.ini'");
    expect(harness).toContain('Boundary bootstrap failure:');
    expect(harness).toContain("Get-IniValue -Path $statePath -Key 'previous0'");
    expect(harness).not.toContain("Get-IniValue -Path $statePath -Key 'previous')");
    expect(bootstrap).not.toMatch(/bootstrap-root|install-dir/i);
  });
});

describe('Windows packaging integration contract', () => {
  it('uses the custom self-extracting bootstrap instead of portable mode', () => {
    const config = read('electron-builder.yml');

    expect(config).toContain('target: nsis');
    expect(config).toContain("script: 'build/windows/relay-bootstrap.nsi'");
    expect(config).toContain('packElevateHelper: false');
    expect(config).toContain('useZip: false');
    expect(config).toContain("nsis: '1.2.1'");
    expect(config).not.toContain('target: portable');
  });

  it('gives every Windows CI artifact a commit build ID and real smoke test', () => {
    const reusable = readWorkflow('.github/workflows/reusable-windows-package.yml');
    const packageJob = reusable.jobs.package;
    const smoke = findStep(packageJob, 'Smoke test persistent bootstrap');
    const benchmark = findStep(packageJob, 'Benchmark packaged startup paths');
    const boundary = findStep(
      packageJob,
      'Exercise isolated activation boundaries and stable fallback',
    );

    expect(packageJob.env.RELAY_BUILD_ID).toBe('r1-${{ inputs.source-sha }}');
    expect(smoke.env.RELAY_EXPECTED_BUILD_ID).toBe('r1-${{ inputs.source-sha }}');
    expect(smoke.run).toContain('steps.previous.outputs.build_id');
    expect(smoke.run).toContain('scripts/windows-bootstrap-smoke.ps1');
    expect(smoke.run).toContain('-PreviousArtifact');
    expect(smoke.env.RELAY_BOOTSTRAP_SMOKE_CONFIRM).toBe(1);
    expect(benchmark.run).toContain('--scenario prepare');
    expect(benchmark.run).toContain('--scenario stable');
    expect(benchmark.run).toContain('--runs 5');
    expect(benchmark.env.RELAY_BOOTSTRAP_BENCHMARK_CONFIRM).toBe(1);
    expect(boundary.run).toContain('scripts/windows-bootstrap-boundary-smoke.ps1');
    expect(findStep(packageJob, 'Build previous isolated boundary fixture').env).toHaveProperty(
      'RELAY_BOOTSTRAP_HARNESS_ROOT',
    );
    expect(boundary.env.RELAY_BOOTSTRAP_BOUNDARY_CONFIRM).toBe(1);

    for (const file of ['.github/workflows/build.yml', '.github/workflows/release.yml']) {
      const caller = readWorkflow(file);
      expect(caller.jobs['package-windows'].uses).toBe(
        './.github/workflows/reusable-windows-package.yml',
      );
      expect(caller.jobs['package-windows'].with['source-sha']).toBeTruthy();
    }
  });

  it('packages one real app and uses prior artifacts plus lightweight boundary fixtures', () => {
    const previousArtifact = read('scripts/find-previous-windows-artifact.ps1');

    expect(previousArtifact).toContain('status=success');
    expect(previousArtifact).toContain('$CurrentSha');
    expect(previousArtifact).toContain("$_.name -eq 'relay-windows'");
    expect(previousArtifact).toContain('gh run download');
    expect(previousArtifact).toContain('GITHUB_OUTPUT');
    expect(previousArtifact).toContain('[AllowEmptyString()]');
    expect(previousArtifact).toContain("Write-StepOutput -Name 'found' -Value 'false'");

    const reusable = readWorkflow('.github/workflows/reusable-windows-package.yml');
    const packageJob = reusable.jobs.package;
    const commands = packageJob.steps.map((step) => String(step.run ?? ''));

    expect(reusable.permissions.actions).toBe('read');
    expect(findStep(packageJob, 'Find previous successful Windows artifact').run).toContain(
      'scripts/find-previous-windows-artifact.ps1',
    );
    expect(commands.filter((command) => command.includes('npm run build'))).toHaveLength(1);
    expect(findStep(packageJob, 'Cache rebuilt better-sqlite3')).toBeDefined();
    expect(findStep(packageJob, 'Install Electron native dependencies').run).toContain(
      'electron-builder install-app-deps',
    );
    expect(
      findStep(packageJob, 'Build lightweight previous fixture when no artifact exists').run,
    ).toContain('node scripts/package-windows.mjs --fixture');
    expect(findStep(packageJob, 'Smoke test persistent bootstrap').run).toContain(
      'steps.previous.outputs.build_id',
    );
    expect(commands.join('\n')).not.toContain('npm run package:win');
  });

  it('provides an opt-in same-host compression and former-portable comparison', () => {
    const workflow = readWorkflow('.github/workflows/windows-startup-comparison.yml');
    const comparison = read('scripts/windows-startup-comparison.ps1');
    const commands = workflow.jobs.compare.steps.map((step) => String(step.run ?? '')).join('\n');

    expect(workflow.on).toEqual({ workflow_dispatch: null });
    expect(commands).toContain('--config.compression=store');
    expect(commands).toContain('--config.compression=normal');
    expect(commands).toContain('--config.compression=maximum');
    expect(commands).toContain('--win portable');
    expect(commands).toContain('windows-startup-comparison.json');
    expect(comparison).toContain("--scenario', 'prepare'");
    expect(comparison).toContain("--scenario', 'stable'");
    expect(comparison).toContain("--scenario', 'portable'");
    expect(comparison).toContain('RecommendedCompression');
    expect(comparison).toContain('BeatsPortableBaseline');
    expect(comparison).toContain('PrepareRendererMountedWallMadMs');
    expect(comparison).toContain('MinimumMeaningfulDifferenceMs');
    expect(comparison).toContain('SelectionConfidence');
    expect(comparison).toContain('Get-RandomizedCandidateOrder');
    expect(comparison).toContain("Kind = 'portable'");
    expect(comparison).toContain('AllCandidateVarianceAcceptable');
    expect(comparison).toContain('$null');
    expect(comparison).toContain('RELAY_STARTUP_COMPARISON_CONFIRM');
  });
});
