Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
WindowIcon off

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StdUtils.nsh"
!include "Win\WinError.nsh"
!include "include\relay-runtime-contract.nsh"

!ifndef RELAY_LAUNCHER_OUT
  !error "RELAY_LAUNCHER_OUT is required"
!endif
!ifndef RELAY_LAUNCHER_ICON
  !error "RELAY_LAUNCHER_ICON is required"
!endif
!ifndef RELAY_PROBATION_DURATION_MS
  !error "RELAY_PROBATION_DURATION_MS is required"
!endif
!ifndef RELAY_PROBATION_SUPERVISOR_TIMEOUT_MS
  !error "RELAY_PROBATION_SUPERVISOR_TIMEOUT_MS is required"
!endif
!ifndef RELAY_RUNTIME_ROOT
  !define RELAY_RUNTIME_ROOT "$LOCALAPPDATA\Relay"
!endif

Name "Relay"
OutFile "${RELAY_LAUNCHER_OUT}"
Icon "${RELAY_LAUNCHER_ICON}"
BrandingText "Relay"
VIProductVersion "2.0.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Relay"
VIAddVersionKey /LANG=1033 "FileDescription" "Relay Launcher and Recovery Supervisor"
VIAddVersionKey /LANG=1033 "FileVersion" "2.0.0.0"
VIAddVersionKey /LANG=1033 "ProductVersion" "2.0.0.0"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright Relay Team"

Var RelayArgs
Var RelayRoot
Var RelayState
Var RelayStateNew
Var RelayProtocol
Var RelayGeneration
Var RelayBuildId
Var RelayBuildIsValid
Var RelayRuntimeIsUsable
Var RelayRuntimeDir
Var RelayExecutable
Var RelayMarker
Var RelayMarkerProtocol
Var RelayMarkerBuildId
Var RelayMarkerExecutable
Var RelayMarkerPayloadHash
Var RelayMarkerHash
Var RelayContentIntegrity
Var RelayMarkerVersion
Var RelayMarkerReleaseTag
Var RelayMarkerCommit
Var RelayMarkerServerEpoch
Var RelayMarkerClientEpoch
Var RelayCatalogRuntimeHash
Var RelayCatalogVersion
Var RelayCatalogReleaseTag
Var RelayCatalogCommit
Var RelayCatalogInstallerHash
Var RelayCatalogServerEpoch
Var RelayCatalogClientEpoch
Var RelayCatalogHealth
Var RelayPayloadHashLength
Var RelayPayloadHashFiltered
Var RelayBinaryResult
Var RelayLockHandle
Var RelayLockError
Var RelayRecoveryRequested
Var RelayRecoveryRoot
Var RelayRequest
Var RelayPrepared
Var RelayProbationResult
Var RelayRollbackRequest
Var RelaySettlement
Var RelaySettlementNew
Var RelayCandidate
Var RelayCurrent
Var RelayPrevious0
Var RelayPrevious1
Var RelayPrevious2
Var RelayDroppedBuild
Var RelayTransactionId
Var RelayTransactionIsValid
Var RelayTransactionSource
Var RelayTransactionTarget
Var RelayTransactionMode
Var RelayTransactionSnapshot
Var RelayProbationAttempts
Var RelayExitCode
Var RelayResultProtocol
Var RelayResultTransaction
Var RelayResultBuild
Var RelayResultStatus
Var RelayResultDuration
Var RelayRequestProtocol
Var RelayRequestTransaction
Var RelayRequestTargetVersion
Var RelayRequestTargetCommitish
Var RelayRequestInstallerHash
Var RelayRequestMode
Var RelayRequestCheckpoint
Var RelayRequestSnapshot
Var RelayRequestRequestedAt
Var RelaySourceBuild
Var RelaySourceVersion
Var RelaySourceReleaseTag
Var RelaySourceCommit
Var RelaySourceRuntimeHash
Var RelaySourceInstallerHash
Var RelaySourceRecoveryProtocol
Var RelaySourceServerEpoch
Var RelaySourceClientEpoch
Var RelaySourceInstalledAt
Var RelayPreparedProtocol
Var RelayPreparedTransaction
Var RelayPreparedBuild
Var RelayPreparedVersion
Var RelayPreparedReleaseTag
Var RelayPreparedCommit
Var RelayPreparedRuntimeHash
Var RelayPreparedInstallerHash
Var RelayPreparedRecoveryProtocol
Var RelayPreparedServerEpoch
Var RelayPreparedClientEpoch
Var RelayPreparedAt
Var RelayPreparedHealth
Var RelayFailedFingerprint
Var RelayFailedFingerprints
Var RelayNewFailedFingerprints
Var RelayExistingFingerprint
Var RelayFailedFingerprintIndex
Var RelayFailedFingerprintCount
Var RelayRestoreResult
Var RelaySnapshotRoot
Var RelaySnapshotMarker
Var RelaySnapshotProtocol
Var RelaySnapshotId
Var RelaySnapshotTransaction
Var RelayExpectedSnapshotTransaction
Var RelaySnapshotSource
Var RelaySnapshotComplete
Var RelayLiveData
Var RelayFailedData
Var RelayRestoreJournal
Var RelayRestoreJournalTransaction
Var RelayRestoreJournalPhase
Var RelayRestoreJournalExpectedCurrent
Var RelayCatalogCurrent
Var RelayCatalogCandidate
Var RelayCatalogTransaction
Var RelayCatalogPrevious0
Var RelayManualProtocol
Var RelayManualTransaction
Var RelayManualSource
Var RelayManualTarget
Var RelayManualMode
Var RelayManualCheckpoint
Var RelayManualTargetSnapshot
Var RelayManualSourceSnapshot
Var RelayManualRequestedAt
Var RelayManualTargetHealth
Var RelayManualCurrentServerEpoch
Var RelayManualCurrentClientEpoch
Var RelayManualTargetServerEpoch
Var RelayManualTargetClientEpoch
Var RelayNewPrevious1
Var RelayNewPrevious2
Var RelaySettlementProtocol
Var RelaySettlementTransaction
Var RelaySettlementOutcome
Var RelaySettlementSource
Var RelaySettlementTarget
Var RelaySettlementWriteResult
Var RelayReconcileSettled
Var RelayReconcileFingerprintFound
Var RelayProbationProcessInfo
Var RelayProbationStartupInfo
Var RelayProbationProcessHandle
Var RelayProbationThreadHandle
Var RelayProbationWaitResult

Function RelayRunProbation
  StrCpy $RelayExitCode "1"
  StrCpy $RelayProbationWaitResult "allocation-failed"
  !ifdef RELAY_LAUNCHER_HARNESS
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "nativeStage" "allocating"
  !endif
  System::Call '*(p,p,i,i)p.r0'
  StrCpy $RelayProbationProcessInfo $0
  System::Alloc 68
  Pop $RelayProbationStartupInfo
  ${If} $RelayProbationProcessInfo == 0
  ${OrIf} $RelayProbationStartupInfo == 0
    ${If} $RelayProbationProcessInfo != 0
      System::Free $RelayProbationProcessInfo
    ${EndIf}
    ${If} $RelayProbationStartupInfo != 0
      System::Free $RelayProbationStartupInfo
    ${EndIf}
    Return
  ${EndIf}
  System::Call '*$RelayProbationStartupInfo(i 68)'
  StrCpy $RelayArgs '"$RelayExecutable" ${RELAY_RECOVERY_PROBATION_PREFIX}$RelayTransactionId'
  StrCpy $RelayProbationWaitResult "create-failed"
  !ifdef RELAY_LAUNCHER_HARNESS
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "nativeStage" "creating"
  !endif
  System::Call 'kernel32::CreateProcessW(w "$RelayExecutable", w "$RelayArgs", p 0, p 0, i 0, i 0x04000000, p 0, w "$RelayRuntimeDir", p $RelayProbationStartupInfo, p $RelayProbationProcessInfo) i.r0'
  ${If} $0 == 0
    System::Free $RelayProbationStartupInfo
    System::Free $RelayProbationProcessInfo
    Return
  ${EndIf}
  !ifdef RELAY_LAUNCHER_HARNESS
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "nativeStage" "created"
  !endif
  System::Call '*$RelayProbationProcessInfo(p.r1,p.r2,i.r3,i.r4)'
  StrCpy $RelayProbationProcessHandle $1
  StrCpy $RelayProbationThreadHandle $2
  System::Call 'kernel32::WaitForSingleObject(p $RelayProbationProcessHandle, i ${RELAY_PROBATION_SUPERVISOR_TIMEOUT_MS}) i.r0'
  StrCpy $RelayProbationWaitResult $0
  !ifdef RELAY_LAUNCHER_HARNESS
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "nativeStage" "waited"
  !endif
  ${If} $RelayProbationWaitResult == 258
    ; A wedged candidate cannot hold the stable launcher indefinitely.
    System::Call 'kernel32::TerminateProcess(p $RelayProbationProcessHandle, i 1) i.r0'
    System::Call 'kernel32::WaitForSingleObject(p $RelayProbationProcessHandle, i 5000) i.r0'
  ${ElseIf} $RelayProbationWaitResult == 0
    System::Call 'kernel32::GetExitCodeProcess(p $RelayProbationProcessHandle, *i.r0) i.r1'
    ${If} $1 != 0
      StrCpy $RelayExitCode $0
    ${EndIf}
  ${EndIf}

  System::Call 'kernel32::CloseHandle(p $RelayProbationThreadHandle) i.r0'
  System::Call 'kernel32::CloseHandle(p $RelayProbationProcessHandle) i.r0'
  System::Free $RelayProbationStartupInfo
  System::Free $RelayProbationProcessInfo
FunctionEnd

!macro RelayRuntimeIsUsable BUILD_ID RESULT
  StrCpy ${RESULT} "0"
  !insertmacro RelayValidateBuildId "${BUILD_ID}" $RelayBuildIsValid
  ${If} $RelayBuildIsValid == "1"
    StrCpy $RelayRuntimeDir "$RelayRoot\Runtime\${BUILD_ID}"
    StrCpy $RelayExecutable "$RelayRuntimeDir\${RELAY_INNER_EXECUTABLE}"
    StrCpy $RelayMarker "$RelayRuntimeDir\${RELAY_RUNTIME_MARKER}"
    ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"
    ReadINIStr $RelayMarkerBuildId "$RelayMarker" "Relay" "buildId"
    ReadINIStr $RelayMarkerExecutable "$RelayMarker" "Relay" "executable"
    ReadINIStr $RelayMarkerPayloadHash "$RelayMarker" "Relay" "payloadHash"
    ReadINIStr $RelayMarkerVersion "$RelayMarker" "Relay" "version"
    ReadINIStr $RelayMarkerReleaseTag "$RelayMarker" "Relay" "releaseTag"
    ReadINIStr $RelayMarkerCommit "$RelayMarker" "Relay" "targetCommitish"
    ReadINIStr $RelayMarkerServerEpoch "$RelayMarker" "Relay" "serverDataEpoch"
    ReadINIStr $RelayMarkerClientEpoch "$RelayMarker" "Relay" "clientDataEpoch"
    StrCpy $RelayMarkerHash ""
    StrCpy $RelayContentIntegrity "0"
    ${If} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
      ${StdUtils.HashFile} $RelayMarkerHash "SHA2-512" "$RelayMarker"
      !insertmacro RelayVerifyRuntimeContent "$RelayRuntimeDir" "$RelayMarker" $RelayContentIntegrity
    ${EndIf}
    StrLen $RelayPayloadHashLength $RelayMarkerPayloadHash
    ${StrFilter} "$RelayMarkerPayloadHash" "" "0123456789abcdefABCDEF" "" $RelayPayloadHashFiltered
    StrCpy $RelayBinaryResult "0"
    ${If} ${FileExists} "$RelayExecutable"
      System::Call 'kernel32::GetBinaryTypeW(w "$RelayExecutable", *i .r0) i.r1'
      StrCpy $RelayBinaryResult $1
    ${EndIf}
    ${If} $RelayMarkerProtocol == "${RELAY_LEGACY_STATE_PROTOCOL}"
      ${If} $RelayMarkerBuildId == "${BUILD_ID}"
      ${AndIf} $RelayMarkerExecutable == "${RELAY_INNER_EXECUTABLE}"
      ${AndIf} $RelayPayloadHashLength == 128
      ${AndIf} $RelayPayloadHashFiltered == $RelayMarkerPayloadHash
      ${AndIf} $RelayBinaryResult != "0"
        StrCpy ${RESULT} "1"
      ${EndIf}
    ${ElseIf} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
      ReadINIStr $RelayCatalogRuntimeHash "$RelayState" "Build.${BUILD_ID}" "runtimeSha512"
      ReadINIStr $RelayCatalogVersion "$RelayState" "Build.${BUILD_ID}" "version"
      ReadINIStr $RelayCatalogReleaseTag "$RelayState" "Build.${BUILD_ID}" "releaseTag"
      ReadINIStr $RelayCatalogCommit "$RelayState" "Build.${BUILD_ID}" "targetCommitish"
      ReadINIStr $RelayCatalogServerEpoch "$RelayState" "Build.${BUILD_ID}" "serverDataEpoch"
      ReadINIStr $RelayCatalogClientEpoch "$RelayState" "Build.${BUILD_ID}" "clientDataEpoch"
      ReadINIStr $RelayCatalogHealth "$RelayState" "Build.${BUILD_ID}" "health"
      ${If} $RelayCatalogRuntimeHash != ""
        ${If} $RelayMarkerBuildId == "${BUILD_ID}"
        ${AndIf} $RelayMarkerExecutable == "${RELAY_INNER_EXECUTABLE}"
        ${AndIf} $RelayPayloadHashLength == 128
        ${AndIf} $RelayPayloadHashFiltered == $RelayMarkerPayloadHash
        ${AndIf} $RelayMarkerHash == $RelayCatalogRuntimeHash
        ${AndIf} $RelayContentIntegrity == "1"
        ${AndIf} $RelayMarkerVersion == $RelayCatalogVersion
        ${AndIf} $RelayMarkerReleaseTag == $RelayCatalogReleaseTag
        ${AndIf} $RelayMarkerCommit == $RelayCatalogCommit
        ${AndIf} $RelayMarkerServerEpoch == $RelayCatalogServerEpoch
        ${AndIf} $RelayMarkerClientEpoch == $RelayCatalogClientEpoch
        ${AndIf} $RelayBinaryResult != "0"
          ${If} $RelayCatalogHealth == "healthy"
          ${OrIf} $RelayCatalogHealth == "candidate"
            StrCpy ${RESULT} "1"
          ${EndIf}
        ${EndIf}
      ${ElseIf} $RelayPreparedBuild == "${BUILD_ID}"
        ; Before candidate ingestion, bind the new runtime to the independently
        ; validated prepared receipt because it is not in state.ini yet.
        ${If} $RelayMarkerBuildId == "${BUILD_ID}"
        ${AndIf} $RelayMarkerExecutable == "${RELAY_INNER_EXECUTABLE}"
        ${AndIf} $RelayPayloadHashLength == 128
        ${AndIf} $RelayPayloadHashFiltered == $RelayMarkerPayloadHash
        ${AndIf} $RelayMarkerHash == $RelayPreparedRuntimeHash
        ${AndIf} $RelayContentIntegrity == "1"
        ${AndIf} $RelayMarkerVersion == $RelayPreparedVersion
        ${AndIf} $RelayMarkerReleaseTag == $RelayPreparedReleaseTag
        ${AndIf} $RelayMarkerCommit == $RelayPreparedCommit
        ${AndIf} $RelayMarkerServerEpoch == $RelayPreparedServerEpoch
        ${AndIf} $RelayMarkerClientEpoch == $RelayPreparedClientEpoch
        ${AndIf} $RelayPreparedHealth == "candidate"
        ${AndIf} $RelayBinaryResult != "0"
          StrCpy ${RESULT} "1"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

Function RelayRestoreServerSnapshot
  StrCpy $RelayRestoreResult "0"
  !insertmacro RelayValidateTransactionId "$RelayTransactionId" $RelayTransactionIsValid
  ${If} $RelayTransactionIsValid != "1"
    Return
  ${EndIf}
  !insertmacro RelayValidateTransactionId "$RelayTransactionSnapshot" $RelayTransactionIsValid
  ${If} $RelayTransactionIsValid != "1"
    Return
  ${EndIf}
  StrCpy $RelaySnapshotRoot "$APPDATA\Relay\RecoverySnapshots\$RelayTransactionSnapshot"
  StrCpy $RelaySnapshotMarker "$RelaySnapshotRoot\snapshot.ini"
  System::Call 'kernel32::GetFileAttributesW(w "$RelaySnapshotRoot") i.r0'
  ${If} $0 == -1
    Return
  ${EndIf}
  IntOp $1 $0 & 0x400
  ${If} $1 != 0
    Return
  ${EndIf}
  ReadINIStr $RelaySnapshotProtocol "$RelaySnapshotMarker" "Snapshot" "protocol"
  ReadINIStr $RelaySnapshotId "$RelaySnapshotMarker" "Snapshot" "snapshotId"
  ReadINIStr $RelaySnapshotTransaction "$RelaySnapshotMarker" "Snapshot" "transactionId"
  ReadINIStr $RelaySnapshotSource "$RelaySnapshotMarker" "Snapshot" "sourceBuildId"
  ReadINIStr $RelaySnapshotComplete "$RelaySnapshotMarker" "Snapshot" "complete"
  ${If} $RelaySnapshotProtocol != "1"
  ${OrIf} $RelaySnapshotId != "$RelayTransactionSnapshot"
  ${OrIf} $RelaySnapshotTransaction != "$RelayExpectedSnapshotTransaction"
  ${OrIf} $RelaySnapshotSource != "$RelayTransactionSource"
  ${OrIf} $RelaySnapshotComplete != "1"
    Return
  ${EndIf}

  StrCpy $RelayLiveData "$APPDATA\Relay\data"
  StrCpy $RelayFailedData "$APPDATA\Relay\.rollback-$RelayTransactionId.failed"
  StrCpy $RelayRestoreJournal "$APPDATA\Relay\recovery-rollback.ini"
  WriteINIStr "$RelayRestoreJournal" "Restore" "transactionId" "$RelayTransactionId"
  WriteINIStr "$RelayRestoreJournal" "Restore" "snapshotId" "$RelayTransactionSnapshot"
  WriteINIStr "$RelayRestoreJournal" "Restore" "expectedCurrentBuildId" "$RelayTransactionSource"
  WriteINIStr "$RelayRestoreJournal" "Restore" "phase" "prepared"

  ${If} ${FileExists} "$RelaySnapshotRoot\data"
    ${If} ${FileExists} "$RelayLiveData"
      ${If} ${FileExists} "$RelayFailedData"
        Return
      ${EndIf}
      ClearErrors
      Rename "$RelayLiveData" "$RelayFailedData"
      ${If} ${Errors}
        Return
      ${EndIf}
      WriteINIStr "$RelayRestoreJournal" "Restore" "phase" "live-moved"
    ${EndIf}
    ClearErrors
    Rename "$RelaySnapshotRoot\data" "$RelayLiveData"
    ${If} ${Errors}
      ${IfNot} ${FileExists} "$RelayLiveData"
        ClearErrors
        Rename "$RelayFailedData" "$RelayLiveData"
      ${EndIf}
      Return
    ${EndIf}
  ${ElseIf} ${FileExists} "$RelayLiveData"
  ${AndIf} ${FileExists} "$RelayFailedData"
    ; The stopped snapshot was already swapped before an interrupted state commit.
  ${Else}
    Return
  ${EndIf}
  WriteINIStr "$RelayRestoreJournal" "Restore" "phase" "restored"
  StrCpy $RelayRestoreResult "1"
FunctionEnd

Function RelayFinalizeServerRestore
  ${IfNot} ${FileExists} "$RelayRestoreJournal"
    Return
  ${EndIf}
  ReadINIStr $RelayRestoreJournalTransaction "$RelayRestoreJournal" "Restore" "transactionId"
  ReadINIStr $RelayRestoreJournalPhase "$RelayRestoreJournal" "Restore" "phase"
  ReadINIStr $RelayRestoreJournalExpectedCurrent "$RelayRestoreJournal" "Restore" "expectedCurrentBuildId"
  ReadINIStr $RelayProtocol "$RelayState" "Relay" "protocol"
  ReadINIStr $RelayCatalogCurrent "$RelayState" "Relay" "current"
  ReadINIStr $RelayCatalogCandidate "$RelayState" "Relay" "candidate"
  ReadINIStr $RelayCatalogTransaction "$RelayState" "Transaction" "id"
  !insertmacro RelayValidateTransactionId "$RelayRestoreJournalTransaction" $RelayTransactionIsValid
  !insertmacro RelayValidateBuildId "$RelayRestoreJournalExpectedCurrent" $RelayBuildIsValid
  ${If} $RelayTransactionIsValid != "1"
  ${OrIf} $RelayBuildIsValid != "1"
  ${OrIf} $RelayRestoreJournalTransaction != $RelayTransactionId
  ${OrIf} $RelayRestoreJournalPhase != "restored"
  ${OrIf} $RelayProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayRestoreJournalExpectedCurrent != $RelayCatalogCurrent
  ${OrIf} $RelayCatalogCandidate != ""
  ${OrIf} $RelayCatalogTransaction != ""
    Return
  ${EndIf}
  StrCpy $RelayFailedData "$APPDATA\Relay\.rollback-$RelayRestoreJournalTransaction.failed"
  StrCpy $RelayLiveData "$APPDATA\Relay\data"
  ${IfNot} ${FileExists} "$RelayLiveData"
    Return
  ${EndIf}
  RMDir /r "$RelayFailedData"
  ${IfNot} ${FileExists} "$RelayFailedData"
    Delete "$RelayRestoreJournal"
  ${EndIf}
FunctionEnd

Function RelayCleanupCompletedServerRestore
  ${IfNot} ${FileExists} "$RelayRestoreJournal"
    Return
  ${EndIf}
  ReadINIStr $RelayRestoreJournalTransaction "$RelayRestoreJournal" "Restore" "transactionId"
  ReadINIStr $RelayRestoreJournalPhase "$RelayRestoreJournal" "Restore" "phase"
  ReadINIStr $RelayCatalogTransaction "$RelayState" "Transaction" "id"
  !insertmacro RelayValidateTransactionId "$RelayRestoreJournalTransaction" $RelayTransactionIsValid
  ${If} $RelayTransactionIsValid != "1"
  ${OrIf} $RelayRestoreJournalPhase != "restored"
  ${OrIf} $RelayCatalogTransaction != ""
    Return
  ${EndIf}
  StrCpy $RelayTransactionId $RelayRestoreJournalTransaction
  Call RelayFinalizeServerRestore
FunctionEnd

Function RelayBuildFailedFingerprintHistory
  ReadINIStr $RelayFailedFingerprints "$RelayState" "Relay" "failedReleaseFingerprints"
  StrCpy $RelayNewFailedFingerprints "$RelayFailedFingerprint"
  StrCpy $RelayFailedFingerprintIndex 1
  StrCpy $RelayFailedFingerprintCount 1

RelayFailedFingerprintLoop:
  ${If} $RelayFailedFingerprintCount < 16
  ${AndIf} $RelayFailedFingerprintIndex <= 16
    ${WordFind} "$RelayFailedFingerprints," "," "+$RelayFailedFingerprintIndex" $RelayExistingFingerprint
    ${If} $RelayExistingFingerprint == ""
    ${OrIf} $RelayExistingFingerprint == "1"
      Goto RelayFailedFingerprintDone
    ${EndIf}
    ${If} $RelayExistingFingerprint != $RelayFailedFingerprint
      StrCpy $RelayNewFailedFingerprints "$RelayNewFailedFingerprints,$RelayExistingFingerprint"
      IntOp $RelayFailedFingerprintCount $RelayFailedFingerprintCount + 1
    ${EndIf}
    IntOp $RelayFailedFingerprintIndex $RelayFailedFingerprintIndex + 1
    Goto RelayFailedFingerprintLoop
  ${EndIf}

RelayFailedFingerprintDone:
FunctionEnd

Function RelayWriteSettlementIntent
  StrCpy $RelaySettlementWriteResult "0"
  Delete "$RelaySettlementNew"
  ClearErrors
  WriteINIStr "$RelaySettlementNew" "Settlement" "protocol" "${RELAY_RECOVERY_STATE_PROTOCOL}"
  WriteINIStr "$RelaySettlementNew" "Settlement" "transactionId" "$RelayTransactionId"
  WriteINIStr "$RelaySettlementNew" "Settlement" "outcome" "$RelaySettlementOutcome"
  WriteINIStr "$RelaySettlementNew" "Settlement" "sourceBuildId" "$RelayTransactionSource"
  WriteINIStr "$RelaySettlementNew" "Settlement" "targetBuildId" "$RelayTransactionTarget"
  IfErrors RelayWriteSettlementIntentFailed
  System::Call 'kernel32::MoveFileExW(w "$RelaySettlementNew", w "$RelaySettlement", i 9) i.r0'
  ${If} $0 != 0
    StrCpy $RelaySettlementWriteResult "1"
    Return
  ${EndIf}

RelayWriteSettlementIntentFailed:
  Delete "$RelaySettlementNew"
FunctionEnd

Function RelayReconcileSettledUpdateRequest
  ; A settlement intent is written before the catalog commit. It lets the next
  ; launcher prove exactly which transaction reached a terminal state if the
  ; previous launcher died before removing update-request.ini.
  Delete "$RelaySettlementNew"
  ${IfNot} ${FileExists} "$RelaySettlement"
    Return
  ${EndIf}
  ${IfNot} ${FileExists} "$RelayRequest"
    Delete "$RelaySettlement"
    Return
  ${EndIf}

  ReadINIStr $RelaySettlementProtocol "$RelaySettlement" "Settlement" "protocol"
  ReadINIStr $RelaySettlementTransaction "$RelaySettlement" "Settlement" "transactionId"
  ReadINIStr $RelaySettlementOutcome "$RelaySettlement" "Settlement" "outcome"
  ReadINIStr $RelaySettlementSource "$RelaySettlement" "Settlement" "sourceBuildId"
  ReadINIStr $RelaySettlementTarget "$RelaySettlement" "Settlement" "targetBuildId"
  ReadINIStr $RelayRequestProtocol "$RelayRequest" "RecoveryRequest" "protocol"
  ReadINIStr $RelayRequestTransaction "$RelayRequest" "RecoveryRequest" "transactionId"
  ReadINIStr $RelayRequestTargetVersion "$RelayRequest" "RecoveryRequest" "targetVersion"
  ReadINIStr $RelayRequestTargetCommitish "$RelayRequest" "RecoveryRequest" "targetCommitish"
  ReadINIStr $RelayRequestInstallerHash "$RelayRequest" "RecoveryRequest" "targetInstallerSha256"
  ReadINIStr $RelayRequestCheckpoint "$RelayRequest" "RecoveryRequest" "checkpoint"
  ReadINIStr $RelaySourceBuild "$RelayRequest" "Source" "buildId"
  !insertmacro RelayValidateTransactionId "$RelaySettlementTransaction" $RelayTransactionIsValid
  ${If} $RelaySettlementProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayRequestProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayTransactionIsValid != "1"
  ${OrIf} $RelaySettlementTransaction != $RelayRequestTransaction
  ${OrIf} $RelaySettlementSource != $RelaySourceBuild
  ${OrIf} $RelaySettlementSource == $RelaySettlementTarget
  ${OrIf} $RelayRequestCheckpoint != "complete"
    Return
  ${EndIf}
  !insertmacro RelayValidateBuildId "$RelaySettlementSource" $RelayBuildIsValid
  ${If} $RelayBuildIsValid != "1"
    Return
  ${EndIf}
  !insertmacro RelayValidateBuildId "$RelaySettlementTarget" $RelayBuildIsValid
  ${If} $RelayBuildIsValid != "1"
    Return
  ${EndIf}

  ReadINIStr $RelayProtocol "$RelayState" "Relay" "protocol"
  ReadINIStr $RelayCatalogCurrent "$RelayState" "Relay" "current"
  ReadINIStr $RelayCatalogCandidate "$RelayState" "Relay" "candidate"
  ReadINIStr $RelayCatalogTransaction "$RelayState" "Transaction" "id"
  ReadINIStr $RelayCatalogPrevious0 "$RelayState" "Relay" "previous0"
  ${If} $RelayProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayCatalogCandidate != ""
  ${OrIf} $RelayCatalogTransaction != ""
    Return
  ${EndIf}

  StrCpy $RelayReconcileSettled "0"
  ${If} $RelaySettlementOutcome == "promoted"
    ReadINIStr $RelayCatalogVersion "$RelayState" "Build.$RelayCatalogCurrent" "version"
    ReadINIStr $RelayCatalogCommit "$RelayState" "Build.$RelayCatalogCurrent" "targetCommitish"
    ReadINIStr $RelayCatalogInstallerHash "$RelayState" "Build.$RelayCatalogCurrent" "installerSha256"
    ${If} $RelayCatalogCurrent == $RelaySettlementTarget
    ${AndIf} $RelayCatalogPrevious0 == $RelaySettlementSource
    ${AndIf} $RelayCatalogVersion == $RelayRequestTargetVersion
    ${AndIf} $RelayCatalogCommit == $RelayRequestTargetCommitish
    ${AndIf} $RelayCatalogInstallerHash == $RelayRequestInstallerHash
      StrCpy $RelayReconcileSettled "1"
    ${EndIf}
  ${ElseIf} $RelaySettlementOutcome == "rolled-back"
    ReadINIStr $RelayCatalogVersion "$RelayState" "Build.$RelaySettlementTarget" "version"
    ReadINIStr $RelayFailedFingerprints "$RelayState" "Relay" "failedReleaseFingerprints"
    StrCpy $RelayFailedFingerprint "v$RelayRequestTargetVersion@$RelayRequestTargetCommitish"
    StrCpy $RelayFailedFingerprintIndex 1
    StrCpy $RelayReconcileFingerprintFound "0"

RelayReconcileFingerprintLoop:
    ${If} $RelayFailedFingerprintIndex <= 16
      ${WordFind} "$RelayFailedFingerprints," "," "+$RelayFailedFingerprintIndex" $RelayExistingFingerprint
      ${If} $RelayExistingFingerprint == ""
      ${OrIf} $RelayExistingFingerprint == "1"
        Goto RelayReconcileFingerprintDone
      ${EndIf}
      ${If} $RelayExistingFingerprint == $RelayFailedFingerprint
        StrCpy $RelayReconcileFingerprintFound "1"
        Goto RelayReconcileFingerprintDone
      ${EndIf}
      IntOp $RelayFailedFingerprintIndex $RelayFailedFingerprintIndex + 1
      Goto RelayReconcileFingerprintLoop
    ${EndIf}

RelayReconcileFingerprintDone:
    ${If} $RelayCatalogCurrent == $RelaySettlementSource
    ${AndIf} $RelayCatalogVersion == ""
    ${AndIf} $RelayReconcileFingerprintFound == "1"
      StrCpy $RelayReconcileSettled "1"
    ${EndIf}
  ${EndIf}

  ${If} $RelayReconcileSettled == "1"
    Delete "$RelayRequest"
    ${IfNot} ${FileExists} "$RelayRequest"
      Delete "$RelayPrepared"
      Delete "$RelayProbationResult"
      Delete "$RelaySettlement"
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro RelayTryRuntime BUILD_ID
  !insertmacro RelayRuntimeIsUsable "${BUILD_ID}" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable == "1"
    SetOutPath "$RelayRuntimeDir"
    ClearErrors
    Exec '"$RelayExecutable" $RelayArgs'
    ${IfNot} ${Errors}
      SetErrorLevel 0
      Quit
    ${EndIf}
  ${EndIf}
!macroend

!macro RelayTryRecoveryRuntime BUILD_ID
  !insertmacro RelayRuntimeIsUsable "${BUILD_ID}" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable == "1"
    SetOutPath "$RelayRuntimeDir"
    ClearErrors
    Exec '"$RelayExecutable" ${RELAY_RECOVERY_CENTER_ARGUMENT}'
    ${IfNot} ${Errors}
      SetErrorLevel 0
      Quit
    ${EndIf}
  ${EndIf}
!macroend

Function .onInit
  SetShellVarContext current
  ${GetParameters} $RelayArgs
  StrCpy $RelayRoot "${RELAY_RUNTIME_ROOT}"
  ${If} $RelayArgs == "${RELAY_LAUNCHER_PROBE}"
    SetErrorLevel ${RELAY_LAUNCHER_PROTOCOL_EXIT_CODE}
    Quit
  ${EndIf}
  System::Call 'kernel32::CreateFileW(w "$RelayRoot\launcher.lock", i 0x40000000, i 0, p 0, i 4, i 0x80, p 0) p.r0 ?e'
  Pop $RelayLockError
  StrCpy $RelayLockHandle $0
  ${If} $RelayLockHandle == -1
    ${If} $RelayLockError == ${ERROR_SHARING_VIOLATION}
      SetErrorLevel 0
      Quit
    ${EndIf}
    SetErrorLevel 1
    Quit
  ${EndIf}
FunctionEnd

Section
  StrCpy $RelayState "$RelayRoot\state.ini"
  StrCpy $RelayStateNew "$RelayRoot\state.ini.new"
  StrCpy $RelayRecoveryRoot "$RelayRoot\Recovery"
  StrCpy $RelayRequest "$RelayRecoveryRoot\update-request.ini"
  StrCpy $RelayPrepared "$RelayRoot\Recovery\prepared.ini"
  StrCpy $RelayProbationResult "$RelayRoot\Recovery\probation-result.ini"
  StrCpy $RelayRollbackRequest "$RelayRoot\Recovery\rollback-request.ini"
  StrCpy $RelaySettlement "$RelayRoot\Recovery\settled-update.ini"
  StrCpy $RelaySettlementNew "$RelayRoot\Recovery\settled-update.ini.new"
  StrCpy $RelayRestoreJournal "$APPDATA\Relay\recovery-rollback.ini"
  StrCpy $RelayRecoveryRequested "0"
  ${If} $RelayArgs == "${RELAY_RECOVERY_ARGUMENT}"
    StrCpy $RelayRecoveryRequested "1"
  ${EndIf}

  Call RelayReconcileSettledUpdateRequest
  Call RelayCleanupCompletedServerRestore
  ReadINIStr $RelayProtocol "$RelayState" "Relay" "protocol"
  ${If} $RelayProtocol == "${RELAY_LEGACY_STATE_PROTOCOL}"
    ReadINIStr $RelayCurrent "$RelayState" "Relay" "current"
    ${If} ${FileExists} "$RelayPrepared"
      Goto IngestPreparedCandidate
    ${EndIf}
    ${If} $RelayRecoveryRequested == "1"
      !insertmacro RelayTryRecoveryRuntime "$RelayCurrent"
      ReadINIStr $RelayBuildId "$RelayState" "Relay" "previous"
      !insertmacro RelayTryRecoveryRuntime "$RelayBuildId"
      Goto OpenPublishedReleases
    ${EndIf}
    StrCpy $RelayBuildId $RelayCurrent
    !insertmacro RelayTryRuntime "$RelayBuildId"
    ReadINIStr $RelayBuildId "$RelayState" "Relay" "previous"
    !insertmacro RelayTryRuntime "$RelayBuildId"
    Goto NoUsableRuntime
  ${EndIf}

  ${If} $RelayProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
    Goto NoUsableRuntime
  ${EndIf}
  ReadINIStr $RelayCurrent "$RelayState" "Relay" "current"
  ReadINIStr $RelayPrevious0 "$RelayState" "Relay" "previous0"
  ReadINIStr $RelayPrevious1 "$RelayState" "Relay" "previous1"
  ReadINIStr $RelayPrevious2 "$RelayState" "Relay" "previous2"
  ReadINIStr $RelayCandidate "$RelayState" "Relay" "candidate"

  ${If} $RelayCandidate != ""
    Goto SuperviseCandidate
  ${EndIf}
  ${If} ${FileExists} "$RelayRollbackRequest"
    Goto HandleManualRollback
  ${EndIf}
  ${If} ${FileExists} "$RelayPrepared"
    Goto IngestPreparedCandidate
  ${EndIf}
  ${If} $RelayRecoveryRequested == "1"
    !insertmacro RelayTryRecoveryRuntime "$RelayPrevious0"
    !insertmacro RelayTryRecoveryRuntime "$RelayPrevious1"
    !insertmacro RelayTryRecoveryRuntime "$RelayPrevious2"
    !insertmacro RelayTryRecoveryRuntime "$RelayCurrent"
    Goto OpenPublishedReleases
  ${EndIf}
  StrCpy $RelayBuildId $RelayCurrent
  !insertmacro RelayTryRuntime "$RelayBuildId"
  !insertmacro RelayTryRecoveryRuntime "$RelayPrevious0"
  !insertmacro RelayTryRecoveryRuntime "$RelayPrevious1"
  !insertmacro RelayTryRecoveryRuntime "$RelayPrevious2"
  Goto NoUsableRuntime

HandleManualRollback:
  ReadINIStr $RelayManualProtocol "$RelayRollbackRequest" "RollbackRequest" "protocol"
  ReadINIStr $RelayManualTransaction "$RelayRollbackRequest" "RollbackRequest" "transactionId"
  ReadINIStr $RelayManualSource "$RelayRollbackRequest" "RollbackRequest" "sourceBuildId"
  ReadINIStr $RelayManualTarget "$RelayRollbackRequest" "RollbackRequest" "targetBuildId"
  ReadINIStr $RelayManualMode "$RelayRollbackRequest" "RollbackRequest" "mode"
  ReadINIStr $RelayManualCheckpoint "$RelayRollbackRequest" "RollbackRequest" "checkpoint"
  ReadINIStr $RelayManualTargetSnapshot "$RelayRollbackRequest" "RollbackRequest" "targetSnapshotId"
  ReadINIStr $RelayManualSourceSnapshot "$RelayRollbackRequest" "RollbackRequest" "sourceSnapshotId"
  ReadINIStr $RelayManualRequestedAt "$RelayRollbackRequest" "RollbackRequest" "requestedAt"
  !insertmacro RelayValidateTransactionId "$RelayManualTransaction" $RelayTransactionIsValid
  !insertmacro RelayValidateBuildId "$RelayManualSource" $RelayBuildIsValid
  ${If} $RelayManualProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayTransactionIsValid != "1"
  ${OrIf} $RelayBuildIsValid != "1"
  ${OrIf} $RelayManualSource != "$RelayCurrent"
  ${OrIf} $RelayManualCheckpoint != "complete"
    Goto RejectManualRollback
  ${EndIf}
  !insertmacro RelayValidateBuildId "$RelayManualTarget" $RelayBuildIsValid
  ${If} $RelayBuildIsValid != "1"
    Goto RejectManualRollback
  ${EndIf}
  ${If} $RelayManualTarget == "$RelayPrevious0"
  ${OrIf} $RelayManualTarget == "$RelayPrevious1"
  ${OrIf} $RelayManualTarget == "$RelayPrevious2"
  ${Else}
    Goto RejectManualRollback
  ${EndIf}
  !insertmacro RelayRuntimeIsUsable "$RelayManualTarget" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable != "1"
    Goto RejectManualRollback
  ${EndIf}
  ReadINIStr $RelayManualTargetHealth "$RelayState" "Build.$RelayManualTarget" "health"
  ReadINIStr $RelayManualCurrentServerEpoch "$RelayState" "Build.$RelayCurrent" "serverDataEpoch"
  ReadINIStr $RelayManualCurrentClientEpoch "$RelayState" "Build.$RelayCurrent" "clientDataEpoch"
  ReadINIStr $RelayManualTargetServerEpoch "$RelayState" "Build.$RelayManualTarget" "serverDataEpoch"
  ReadINIStr $RelayManualTargetClientEpoch "$RelayState" "Build.$RelayManualTarget" "clientDataEpoch"
  ${If} $RelayManualTargetHealth != "healthy"
  ${OrIf} $RelayManualCurrentServerEpoch != "$RelayManualTargetServerEpoch"
  ${OrIf} $RelayManualCurrentClientEpoch != "$RelayManualTargetClientEpoch"
    Goto RejectManualRollback
  ${EndIf}
  ${If} $RelayManualMode == "server"
    ReadINIStr $RelayTransactionSnapshot "$RelayState" "Build.$RelayManualTarget" "rollbackSnapshotId"
    ${If} $RelayTransactionSnapshot == ""
    ${OrIf} $RelayTransactionSnapshot != "$RelayManualTargetSnapshot"
      Goto RejectManualRollback
    ${EndIf}
    !insertmacro RelayValidateTransactionId "$RelayManualSourceSnapshot" $RelayTransactionIsValid
    ${If} $RelayTransactionIsValid != "1"
      Goto RejectManualRollback
    ${EndIf}
    ; A target snapshot was taken when that build was last current, so its
    ; marker is intentionally bound to the target rather than today's source.
    StrCpy $RelayTransactionId $RelayManualTransaction
    StrCpy $RelayTransactionSource $RelayManualTarget
    StrCpy $RelaySnapshotRoot "$APPDATA\Relay\RecoverySnapshots\$RelayTransactionSnapshot"
    StrCpy $RelaySnapshotMarker "$RelaySnapshotRoot\snapshot.ini"
    ReadINIStr $RelaySnapshotTransaction "$RelaySnapshotMarker" "Snapshot" "transactionId"
    !insertmacro RelayValidateTransactionId "$RelaySnapshotTransaction" $RelayTransactionIsValid
    ${If} $RelayTransactionIsValid != "1"
      Goto RejectManualRollback
    ${EndIf}
    StrCpy $RelayExpectedSnapshotTransaction $RelaySnapshotTransaction
    Call RelayRestoreServerSnapshot
    ${If} $RelayRestoreResult != "1"
      MessageBox MB_OK|MB_ICONSTOP "Relay could not safely restore the selected server snapshot. No recovery catalog changes were made."
      Goto OpenPublishedReleases
    ${EndIf}
  ${ElseIf} $RelayManualMode == "client"
    ${If} $RelayManualTargetSnapshot != ""
    ${OrIf} $RelayManualSourceSnapshot != ""
      Goto RejectManualRollback
    ${EndIf}
  ${Else}
    Goto RejectManualRollback
  ${EndIf}

  ; Move the selected retained build to current, keep the build being left as
  ; the newest predecessor, and preserve the other two predecessors in order.
  StrCpy $RelayNewPrevious1 ""
  StrCpy $RelayNewPrevious2 ""
  ${If} $RelayPrevious0 != "$RelayManualTarget"
    StrCpy $RelayNewPrevious1 $RelayPrevious0
  ${EndIf}
  ${If} $RelayPrevious1 != "$RelayManualTarget"
    ${If} $RelayNewPrevious1 == ""
      StrCpy $RelayNewPrevious1 $RelayPrevious1
    ${Else}
      StrCpy $RelayNewPrevious2 $RelayPrevious1
    ${EndIf}
  ${EndIf}
  ${If} $RelayPrevious2 != "$RelayManualTarget"
    ${If} $RelayNewPrevious1 == ""
      StrCpy $RelayNewPrevious1 $RelayPrevious2
    ${ElseIf} $RelayNewPrevious2 == ""
      StrCpy $RelayNewPrevious2 $RelayPrevious2
    ${EndIf}
  ${EndIf}
  ReadINIStr $RelayGeneration "$RelayState" "Relay" "generation"
  IntOp $RelayGeneration $RelayGeneration + 1
  Delete "$RelayStateNew"
  CopyFiles /SILENT "$RelayState" "$RelayStateNew"
  WriteINIStr "$RelayStateNew" "Relay" "generation" "$RelayGeneration"
  WriteINIStr "$RelayStateNew" "Relay" "current" "$RelayManualTarget"
  WriteINIStr "$RelayStateNew" "Relay" "previous0" "$RelayManualSource"
  WriteINIStr "$RelayStateNew" "Relay" "previous1" "$RelayNewPrevious1"
  WriteINIStr "$RelayStateNew" "Relay" "previous2" "$RelayNewPrevious2"
  WriteINIStr "$RelayStateNew" "Build.$RelayManualTarget" "rollbackSnapshotId" ""
  WriteINIStr "$RelayStateNew" "Build.$RelayManualSource" "rollbackSnapshotId" "$RelayManualSourceSnapshot"
  DeleteINISec "$RelayStateNew" "Transaction"
  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONSTOP "Relay restored the selected data but could not commit the recovery catalog. Restart Relay to resume recovery safely."
    Goto OpenPublishedReleases
  ${EndIf}
  Call RelayFinalizeServerRestore
  Delete "$RelayRollbackRequest"
  Delete "$RelayRequest"
  Delete "$RelayPrepared"
  Delete "$RelayProbationResult"
  StrCpy $RelayBuildId $RelayManualTarget
  StrCpy $RelayArgs ""
  !insertmacro RelayTryRuntime "$RelayBuildId"
  Goto NoUsableRuntime

RejectManualRollback:
  Delete "$RelayRollbackRequest"
  StrCpy $RelayBuildId $RelayCurrent
  StrCpy $RelayArgs ""
  !insertmacro RelayTryRuntime "$RelayBuildId"
  Goto NoUsableRuntime

IngestPreparedCandidate:
  ReadINIStr $RelayRequestProtocol "$RelayRequest" "RecoveryRequest" "protocol"
  ReadINIStr $RelayRequestTransaction "$RelayRequest" "RecoveryRequest" "transactionId"
  ReadINIStr $RelayRequestTargetVersion "$RelayRequest" "RecoveryRequest" "targetVersion"
  ReadINIStr $RelayRequestTargetCommitish "$RelayRequest" "RecoveryRequest" "targetCommitish"
  ReadINIStr $RelayRequestInstallerHash "$RelayRequest" "RecoveryRequest" "targetInstallerSha256"
  ReadINIStr $RelayRequestMode "$RelayRequest" "RecoveryRequest" "mode"
  ReadINIStr $RelayRequestCheckpoint "$RelayRequest" "RecoveryRequest" "checkpoint"
  ReadINIStr $RelayRequestSnapshot "$RelayRequest" "RecoveryRequest" "snapshotId"
  ReadINIStr $RelayRequestRequestedAt "$RelayRequest" "RecoveryRequest" "requestedAt"
  ReadINIStr $RelaySourceBuild "$RelayRequest" "Source" "buildId"
  ReadINIStr $RelaySourceVersion "$RelayRequest" "Source" "version"
  ReadINIStr $RelaySourceReleaseTag "$RelayRequest" "Source" "releaseTag"
  ReadINIStr $RelaySourceCommit "$RelayRequest" "Source" "targetCommitish"
  ReadINIStr $RelaySourceRuntimeHash "$RelayRequest" "Source" "runtimeSha512"
  ReadINIStr $RelaySourceInstallerHash "$RelayRequest" "Source" "installerSha256"
  ReadINIStr $RelaySourceRecoveryProtocol "$RelayRequest" "Source" "recoveryProtocol"
  ReadINIStr $RelaySourceServerEpoch "$RelayRequest" "Source" "serverDataEpoch"
  ReadINIStr $RelaySourceClientEpoch "$RelayRequest" "Source" "clientDataEpoch"
  ReadINIStr $RelaySourceInstalledAt "$RelayRequest" "Source" "installedAt"
  ReadINIStr $RelayPreparedProtocol "$RelayPrepared" "Prepared" "protocol"
  ReadINIStr $RelayPreparedTransaction "$RelayPrepared" "Prepared" "transactionId"
  ReadINIStr $RelayPreparedBuild "$RelayPrepared" "Prepared" "buildId"
  ReadINIStr $RelayPreparedVersion "$RelayPrepared" "Prepared" "version"
  ReadINIStr $RelayPreparedReleaseTag "$RelayPrepared" "Prepared" "releaseTag"
  ReadINIStr $RelayPreparedCommit "$RelayPrepared" "Prepared" "targetCommitish"
  ReadINIStr $RelayPreparedRuntimeHash "$RelayPrepared" "Prepared" "runtimeSha512"
  ReadINIStr $RelayPreparedInstallerHash "$RelayPrepared" "Prepared" "installerSha256"
  ReadINIStr $RelayPreparedRecoveryProtocol "$RelayPrepared" "Prepared" "recoveryProtocol"
  ReadINIStr $RelayPreparedServerEpoch "$RelayPrepared" "Prepared" "serverDataEpoch"
  ReadINIStr $RelayPreparedClientEpoch "$RelayPrepared" "Prepared" "clientDataEpoch"
  ReadINIStr $RelayPreparedAt "$RelayPrepared" "Prepared" "preparedAt"
  ReadINIStr $RelayPreparedHealth "$RelayPrepared" "Prepared" "health"
  !insertmacro RelayValidateTransactionId "$RelayRequestTransaction" $RelayTransactionIsValid
  !insertmacro RelayValidateBuildId "$RelaySourceBuild" $RelayBuildIsValid
  ${If} $RelayRequestProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayTransactionIsValid != "1"
  ${OrIf} $RelayBuildIsValid != "1"
  ${OrIf} $RelaySourceBuild != "$RelayCurrent"
  ${OrIf} $RelayRequestCheckpoint != "complete"
  ${OrIf} $RelayPreparedProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayPreparedTransaction != "$RelayRequestTransaction"
  ${OrIf} $RelayPreparedVersion != "$RelayRequestTargetVersion"
  ${OrIf} $RelayPreparedCommit != "$RelayRequestTargetCommitish"
  ${OrIf} $RelayPreparedInstallerHash != "$RelayRequestInstallerHash"
  ${OrIf} $RelayPreparedHealth != "candidate"
  ${OrIf} $RelayPreparedServerEpoch != "$RelaySourceServerEpoch"
  ${OrIf} $RelayPreparedClientEpoch != "$RelaySourceClientEpoch"
    Goto RejectPreparedCandidate
  ${EndIf}
  ${If} $RelayRequestMode == "server"
    !insertmacro RelayValidateTransactionId "$RelayRequestSnapshot" $RelayTransactionIsValid
    ${If} $RelayTransactionIsValid != "1"
      Goto RejectPreparedCandidate
    ${EndIf}
  ${ElseIf} $RelayRequestSnapshot != ""
    Goto RejectPreparedCandidate
  ${EndIf}
  !insertmacro RelayRuntimeIsUsable "$RelaySourceBuild" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable != "1"
    Goto RejectPreparedCandidate
  ${EndIf}
  !insertmacro RelayRuntimeIsUsable "$RelayPreparedBuild" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable != "1"
    Goto RejectPreparedCandidate
  ${EndIf}

  Delete "$RelayStateNew"
  ${If} $RelayProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
    CopyFiles /SILENT "$RelayState" "$RelayStateNew"
  ${Else}
    WriteINIStr "$RelayStateNew" "Relay" "protocol" "${RELAY_RECOVERY_STATE_PROTOCOL}"
    WriteINIStr "$RelayStateNew" "Relay" "generation" "1"
    WriteINIStr "$RelayStateNew" "Relay" "current" "$RelaySourceBuild"
    WriteINIStr "$RelayStateNew" "Relay" "previous0" ""
    WriteINIStr "$RelayStateNew" "Relay" "previous1" ""
    WriteINIStr "$RelayStateNew" "Relay" "previous2" ""
    WriteINIStr "$RelayStateNew" "Relay" "failedReleaseFingerprints" ""
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "version" "$RelaySourceVersion"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "releaseTag" "$RelaySourceReleaseTag"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "targetCommitish" "$RelaySourceCommit"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "runtimeSha512" "$RelaySourceRuntimeHash"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "installerSha256" "$RelaySourceInstallerHash"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "recoveryProtocol" "$RelaySourceRecoveryProtocol"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "serverDataEpoch" "$RelaySourceServerEpoch"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "clientDataEpoch" "$RelaySourceClientEpoch"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "installedAt" "$RelaySourceInstalledAt"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "health" "healthy"
    WriteINIStr "$RelayStateNew" "Build.$RelaySourceBuild" "rollbackSnapshotId" ""
  ${EndIf}
  WriteINIStr "$RelayStateNew" "Relay" "candidate" "$RelayPreparedBuild"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "version" "$RelayPreparedVersion"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "releaseTag" "$RelayPreparedReleaseTag"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "targetCommitish" "$RelayPreparedCommit"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "runtimeSha512" "$RelayPreparedRuntimeHash"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "installerSha256" "$RelayPreparedInstallerHash"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "recoveryProtocol" "$RelayPreparedRecoveryProtocol"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "serverDataEpoch" "$RelayPreparedServerEpoch"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "clientDataEpoch" "$RelayPreparedClientEpoch"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "installedAt" "$RelayPreparedAt"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "health" "candidate"
  WriteINIStr "$RelayStateNew" "Build.$RelayPreparedBuild" "rollbackSnapshotId" ""
  WriteINIStr "$RelayStateNew" "Transaction" "id" "$RelayRequestTransaction"
  WriteINIStr "$RelayStateNew" "Transaction" "kind" "update"
  WriteINIStr "$RelayStateNew" "Transaction" "phase" "snapshot-ready"
  WriteINIStr "$RelayStateNew" "Transaction" "sourceBuildId" "$RelaySourceBuild"
  WriteINIStr "$RelayStateNew" "Transaction" "targetBuildId" "$RelayPreparedBuild"
  WriteINIStr "$RelayStateNew" "Transaction" "mode" "$RelayRequestMode"
  WriteINIStr "$RelayStateNew" "Transaction" "snapshotId" "$RelayRequestSnapshot"
  WriteINIStr "$RelayStateNew" "Transaction" "attempts" "0"
  WriteINIStr "$RelayStateNew" "Transaction" "requestedAt" "$RelayRequestRequestedAt"
  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    Goto RejectPreparedCandidate
  ${EndIf}
  Delete "$RelayPrepared"
  StrCpy $RelayCandidate $RelayPreparedBuild
  Goto SuperviseCandidate

SuperviseCandidate:
  ReadINIStr $RelayTransactionId "$RelayState" "Transaction" "id"
  ReadINIStr $RelayTransactionSource "$RelayState" "Transaction" "sourceBuildId"
  ReadINIStr $RelayTransactionTarget "$RelayState" "Transaction" "targetBuildId"
  ReadINIStr $RelayTransactionMode "$RelayState" "Transaction" "mode"
  ReadINIStr $RelayTransactionSnapshot "$RelayState" "Transaction" "snapshotId"
  ReadINIStr $RelayProbationAttempts "$RelayState" "Transaction" "attempts"
  !insertmacro RelayValidateTransactionId "$RelayTransactionId" $RelayTransactionIsValid
  ${If} $RelayTransactionIsValid != "1"
  ${OrIf} $RelayTransactionSource != "$RelayCurrent"
  ${OrIf} $RelayTransactionTarget != "$RelayCandidate"
    Goto RollbackCandidate
  ${EndIf}
  !insertmacro RelayRuntimeIsUsable "$RelayCandidate" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable != "1"
    Goto RollbackCandidate
  ${EndIf}

ProbationLoop:
  ${If} $RelayProbationAttempts >= 2
    Goto RollbackCandidate
  ${EndIf}
  IntOp $RelayProbationAttempts $RelayProbationAttempts + 1
  Delete "$RelayStateNew"
  CopyFiles /SILENT "$RelayState" "$RelayStateNew"
  WriteINIStr "$RelayStateNew" "Transaction" "phase" "probation"
  WriteINIStr "$RelayStateNew" "Transaction" "attempts" "$RelayProbationAttempts"
  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    Goto RollbackCandidate
  ${EndIf}
  Delete "$RelayProbationResult"
  StrCpy $RelayBuildId $RelayCandidate
  !insertmacro RelayRuntimeIsUsable "$RelayBuildId" $RelayRuntimeIsUsable
  ${If} $RelayRuntimeIsUsable != "1"
    Goto RollbackCandidate
  ${EndIf}
  SetOutPath "$RelayRuntimeDir"
  Call RelayRunProbation
  !ifdef RELAY_LAUNCHER_HARNESS
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "attempt" "$RelayProbationAttempts"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "transactionId" "$RelayTransactionId"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "executable" "$RelayExecutable"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "commandLine" "$RelayArgs"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "waitResult" "$RelayProbationWaitResult"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Launch" "exitCode" "$RelayExitCode"
  !endif
  ${If} $RelayExitCode != 0
    Goto ProbationLoop
  ${EndIf}
  ReadINIStr $RelayResultProtocol "$RelayProbationResult" "Probation" "protocol"
  ReadINIStr $RelayResultTransaction "$RelayProbationResult" "Probation" "transactionId"
  ReadINIStr $RelayResultBuild "$RelayProbationResult" "Probation" "buildId"
  ReadINIStr $RelayResultStatus "$RelayProbationResult" "Probation" "status"
  ReadINIStr $RelayResultDuration "$RelayProbationResult" "Probation" "durationMs"
  !ifdef RELAY_LAUNCHER_HARNESS
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Receipt" "protocol" "$RelayResultProtocol"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Receipt" "transactionId" "$RelayResultTransaction"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Receipt" "buildId" "$RelayResultBuild"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Receipt" "status" "$RelayResultStatus"
    WriteINIStr "$RelayRoot\probation-diagnostic.ini" "Receipt" "durationMs" "$RelayResultDuration"
  !endif
  ${If} $RelayResultProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${OrIf} $RelayResultTransaction != "$RelayTransactionId"
  ${OrIf} $RelayResultBuild != "$RelayCandidate"
  ${OrIf} $RelayResultStatus != "healthy"
  ${OrIf} $RelayResultDuration < ${RELAY_PROBATION_DURATION_MS}
    Goto ProbationLoop
  ${EndIf}
  Goto PromoteCandidate

PromoteCandidate:
  ReadINIStr $RelayPrevious0 "$RelayState" "Relay" "previous0"
  ReadINIStr $RelayPrevious1 "$RelayState" "Relay" "previous1"
  ReadINIStr $RelayPrevious2 "$RelayState" "Relay" "previous2"
  ReadINIStr $RelayGeneration "$RelayState" "Relay" "generation"
  IntOp $RelayGeneration $RelayGeneration + 1
  StrCpy $RelayDroppedBuild $RelayPrevious2
  Delete "$RelayStateNew"
  CopyFiles /SILENT "$RelayState" "$RelayStateNew"
  WriteINIStr "$RelayStateNew" "Relay" "generation" "$RelayGeneration"
  WriteINIStr "$RelayStateNew" "Relay" "current" "$RelayCandidate"
  WriteINIStr "$RelayStateNew" "Relay" "candidate" ""
  WriteINIStr "$RelayStateNew" "Relay" "previous0" "$RelayCurrent"
  WriteINIStr "$RelayStateNew" "Relay" "previous1" "$RelayPrevious0"
  WriteINIStr "$RelayStateNew" "Relay" "previous2" "$RelayPrevious1"
  WriteINIStr "$RelayStateNew" "Build.$RelayCandidate" "health" "healthy"
  WriteINIStr "$RelayStateNew" "Build.$RelayCurrent" "rollbackSnapshotId" "$RelayTransactionSnapshot"
  DeleteINISec "$RelayStateNew" "Transaction"
  ${If} $RelayDroppedBuild != ""
    DeleteINISec "$RelayStateNew" "Build.$RelayDroppedBuild"
  ${EndIf}
  StrCpy $RelaySettlementOutcome "promoted"
  Call RelayWriteSettlementIntent
  ${If} $RelaySettlementWriteResult != "1"
    Goto NoUsableRuntime
  ${EndIf}
  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    Goto RollbackCandidate
  ${EndIf}
  Call RelayReconcileSettledUpdateRequest
  StrCpy $RelayBuildId $RelayCandidate
  StrCpy $RelayArgs ""
  !insertmacro RelayTryRuntime "$RelayBuildId"
  Goto NoUsableRuntime

RollbackCandidate:
  ${If} $RelayTransactionMode == "server"
    StrCpy $RelayExpectedSnapshotTransaction $RelayTransactionId
    Call RelayRestoreServerSnapshot
    ${If} $RelayRestoreResult != "1"
      MessageBox MB_OK|MB_ICONSTOP "Relay could not safely restore the pre-update server data. The recovery catalog was left unchanged."
      Goto OpenPublishedReleases
    ${EndIf}
  ${EndIf}
  ReadINIStr $RelayPreparedReleaseTag "$RelayState" "Build.$RelayCandidate" "releaseTag"
  ReadINIStr $RelayPreparedCommit "$RelayState" "Build.$RelayCandidate" "targetCommitish"
  StrCpy $RelayFailedFingerprint "$RelayPreparedReleaseTag@$RelayPreparedCommit"
  Call RelayBuildFailedFingerprintHistory
  ReadINIStr $RelayGeneration "$RelayState" "Relay" "generation"
  IntOp $RelayGeneration $RelayGeneration + 1
  Delete "$RelayStateNew"
  CopyFiles /SILENT "$RelayState" "$RelayStateNew"
  WriteINIStr "$RelayStateNew" "Relay" "generation" "$RelayGeneration"
  WriteINIStr "$RelayStateNew" "Relay" "candidate" ""
  WriteINIStr "$RelayStateNew" "Relay" "failedReleaseFingerprints" "$RelayNewFailedFingerprints"
  DeleteINISec "$RelayStateNew" "Build.$RelayCandidate"
  DeleteINISec "$RelayStateNew" "Transaction"
  StrCpy $RelaySettlementOutcome "rolled-back"
  Call RelayWriteSettlementIntent
  ${If} $RelaySettlementWriteResult != "1"
    Goto NoUsableRuntime
  ${EndIf}
  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    Goto NoUsableRuntime
  ${EndIf}
  Call RelayReconcileSettledUpdateRequest
  Call RelayFinalizeServerRestore
  StrCpy $RelayBuildId $RelayCurrent
  StrCpy $RelayArgs ""
  !insertmacro RelayTryRuntime "$RelayBuildId"
  Goto NoUsableRuntime

RejectPreparedCandidate:
  Delete "$RelayPrepared"
  Delete "$RelayRequest"
  ${If} $RelayCurrent != ""
    StrCpy $RelayBuildId $RelayCurrent
    StrCpy $RelayArgs ""
    !insertmacro RelayTryRuntime "$RelayBuildId"
  ${EndIf}
  Goto NoUsableRuntime

OpenPublishedReleases:
  ExecShell "open" "${RELAY_RELEASES_URL}"
  SetErrorLevel 1
  Quit

NoUsableRuntime:
  MessageBox MB_OK|MB_ICONEXCLAMATION "Relay could not start a retained build. The published Releases page will open so Relay can be repaired."
  Goto OpenPublishedReleases
SectionEnd
