!include "common.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "StdUtils.nsh"
!include "Win\WinError.nsh"
!include "${PROJECT_DIR}\build\windows\include\relay-runtime-contract.nsh"
!include "${PROJECT_DIR}\release\windows-bootstrap\relay-build.nsh"

Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
WindowIcon off
CRCCheck off

!define FILE_ATTRIBUTE_REPARSE_POINT 0x400

Var RelayArgs
Var RelayRoot
Var RelayRuntimeRoot
Var RelayFinalRuntime
Var RelayStaging
Var RelayMarker
Var RelayState
Var RelayStateNew
Var RelayLauncher
Var RelayLauncherNew
Var RelayCurrent
Var RelayPrevious
Var RelayPrevious1
Var RelayPrevious2
Var RelayBuildIsValid
Var RelayResult
Var RelayMarkerProtocol
Var RelayMarkerBuildId
Var RelayMarkerExecutable
Var RelayMarkerPayloadHash
Var RelayBannerVisible
Var RelayFailureMessage
Var RelayLockHandle
Var RelayQuarantine
Var RelayQuarantineActive
Var RelayQuarantineMarkerHandle
Var RelayArchiveHash
Var RelayFallbackBuild
Var RelayRuntimeIsUsable
Var RelayPayloadHashLength
Var RelayPayloadHashFiltered
Var RelayPrepareOnly
Var RelayRepairOnly
Var RelayTransactionId
Var RelayTransactionIsValid
Var RelayRecoveryRoot
Var RelayRequest
Var RelayPrepared
Var RelayPreparedNew
Var RelayRepairRequest
Var RelayRepairResult
Var RelayRepairResultNew
Var RelayRequestProtocol
Var RelayRequestTransaction
Var RelayRequestTargetVersion
Var RelayRequestTargetCommitish
Var RelayRequestInstallerHash
Var RelayRequestSourceBuild
Var RelayRequestCheckpoint
Var RelayRequestSnapshotId
Var RelayRequestMode
Var RelayRequestRequestedAt
Var RelaySelfHash
Var RelayStateProtocol
Var RelayRepairSource
Var RelayRepairTarget
Var RelayRepairVersion
Var RelayRepairCommit
Var RelayRepairInstallerHash
Var RelayRepairCheckpoint
Var RelayRepairRequestedAt
Var RelayRepairCatalogVersion
Var RelayRepairCatalogReleaseTag
Var RelayRepairCatalogCommit
Var RelayRepairCatalogRuntimeHash
Var RelayRepairCatalogInstallerHash
Var RelayRepairCatalogProtocol
Var RelayRepairCatalogServerEpoch
Var RelayRepairCatalogClientEpoch
Var RelayRepairCatalogHealth

!macro RelayHarnessFail SENTINEL MESSAGE
  !ifdef RELAY_BOOTSTRAP_HARNESS
    ${If} ${FileExists} "$RelayRoot\${SENTINEL}"
      StrCpy $RelayFailureMessage "${MESSAGE}"
      System::Call 'kernel32::GetCurrentProcess() p.r0'
      System::Call 'kernel32::TerminateProcess(p r0, i 197) i.r1'
      Goto BootstrapFailed
    ${EndIf}
  !endif
!macroend

!macro RelayRuntimeIsUsable BUILD_ID RESULT
  StrCpy ${RESULT} "0"
  !insertmacro RelayValidateBuildId "${BUILD_ID}" $RelayBuildIsValid
  ${If} $RelayBuildIsValid == "1"
    StrCpy $RelayMarker "$RelayRuntimeRoot\${BUILD_ID}\${RELAY_RUNTIME_MARKER}"
    ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"
    ReadINIStr $RelayMarkerBuildId "$RelayMarker" "Relay" "buildId"
    ReadINIStr $RelayMarkerExecutable "$RelayMarker" "Relay" "executable"
    ReadINIStr $RelayMarkerPayloadHash "$RelayMarker" "Relay" "payloadHash"
    StrLen $RelayPayloadHashLength $RelayMarkerPayloadHash
    ${StrFilter} "$RelayMarkerPayloadHash" "" "0123456789abcdefABCDEF" "" $RelayPayloadHashFiltered
    StrCpy $RelayResult "0"
    ${If} ${FileExists} "$RelayRuntimeRoot\${BUILD_ID}\${APP_EXECUTABLE_FILENAME}"
      System::Call 'kernel32::GetBinaryTypeW(w "$RelayRuntimeRoot\${BUILD_ID}\${APP_EXECUTABLE_FILENAME}", *i .r0) i.r1'
      StrCpy $RelayResult $1
    ${EndIf}
    ${If} $RelayMarkerProtocol == "${RELAY_LEGACY_STATE_PROTOCOL}"
    ${OrIf} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
      ${If} $RelayMarkerBuildId == "${BUILD_ID}"
      ${AndIf} $RelayMarkerExecutable == "${APP_EXECUTABLE_FILENAME}"
      ${AndIf} $RelayPayloadHashLength == 128
      ${AndIf} $RelayPayloadHashFiltered == $RelayMarkerPayloadHash
      ${AndIf} $RelayResult != "0"
        StrCpy ${RESULT} "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!ifdef RELAY_BOOTSTRAP_HARNESS
  !ifndef RELAY_BOOTSTRAP_HARNESS_ROOT
    !error "RELAY_BOOTSTRAP_HARNESS_ROOT is required for harness builds"
  !endif
  !define RELAY_ROOT "${RELAY_BOOTSTRAP_HARNESS_ROOT}"
!else
  !define RELAY_ROOT "$LOCALAPPDATA\Relay"
!endif

Function .onInit
  !insertmacro check64BitAndSetRegView
  SetShellVarContext current
  ${GetParameters} $RelayArgs
  StrCpy $RelayPrepareOnly "$RelayArgs" 19
  StrCpy $RelayRepairOnly "$RelayArgs" 18
  StrCpy $RelayTransactionId ""
  ${GetOptions} "$RelayArgs" "/relay-transaction=" $RelayTransactionId
  ${If} $RelayTransactionId != ""
    !insertmacro RelayValidateTransactionId "$RelayTransactionId" $RelayTransactionIsValid
    ${If} $RelayTransactionIsValid != "1"
      Goto BootstrapLockFailed
    ${EndIf}
    ${If} $RelayPrepareOnly != "/relay-prepare-only"
    ${AndIf} $RelayRepairOnly != "${RELAY_REPAIR_ONLY_ARGUMENT}"
      Goto BootstrapLockFailed
    ${EndIf}
  ${ElseIf} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
    Goto BootstrapLockFailed
  ${EndIf}
  StrCpy $RelayRoot "${RELAY_ROOT}"
  StrCpy $RelayLauncher "$RelayRoot\Relay.exe"

  ClearErrors
  CreateDirectory "$RelayRoot"
  IfErrors BootstrapLockFailed
  System::Call 'kernel32::GetFileAttributesW(w "$RelayRoot") i.r0'
  ${If} $0 == -1
    Goto BootstrapLockFailed
  ${EndIf}
  IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
  ${If} $1 != 0
    Goto BootstrapLockFailed
  ${EndIf}

  System::Call 'kernel32::CreateFileW(w "$RelayRoot\bootstrap.lock", i 0x40000000, i 0, p 0, i 4, i 0x80, p 0) p.r0 ?e'
  Pop $RelayResult
  StrCpy $RelayLockHandle $0
  ${If} $RelayLockHandle == -1
    ${If} $RelayResult == ${ERROR_SHARING_VIOLATION}
      Goto BootstrapAlreadyRunning
    ${EndIf}
    Goto BootstrapLockFailed
  ${EndIf}
  Goto BootstrapLockReady

BootstrapAlreadyRunning:
    ${If} $RelayPrepareOnly == "/relay-prepare-only"
    ${OrIf} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
      SetErrorLevel 1
      Quit
    ${EndIf}
    ${If} ${FileExists} "$RelayLauncher"
      Exec '"$RelayLauncher" $RelayArgs'
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "Relay is already being prepared."
    ${EndIf}
    SetErrorLevel 0
    Quit

BootstrapLockFailed:
  MessageBox MB_OK|MB_ICONSTOP "Relay could not lock its local runtime for preparation."
  SetErrorLevel 1
  Quit

BootstrapLockReady:
FunctionEnd

Section
  InitPluginsDir
  StrCpy $RelayBannerVisible "0"
  StrCpy $RelayQuarantineActive "0"
  StrCpy $RelayRoot "${RELAY_ROOT}"
  StrCpy $RelayRuntimeRoot "$RelayRoot\Runtime"
  StrCpy $RelayFinalRuntime "$RelayRuntimeRoot\${RELAY_BUILD_ID}"
  StrCpy $RelayState "$RelayRoot\state.ini"
  StrCpy $RelayStateNew "$RelayRoot\state.ini.new"
  StrCpy $RelayLauncher "$RelayRoot\Relay.exe"
  StrCpy $RelayLauncherNew "$RelayRoot\Relay.exe.new"
  StrCpy $RelayRecoveryRoot "$RelayRoot\Recovery"
  StrCpy $RelayRequest "$RelayRecoveryRoot\update-request.ini"
  StrCpy $RelayPrepared "$RelayRecoveryRoot\prepared.ini"
  StrCpy $RelayPreparedNew "$RelayRecoveryRoot\prepared.ini.new"
  StrCpy $RelayRepairRequest "$RelayRecoveryRoot\repair-request.ini"
  StrCpy $RelayRepairResult "$RelayRecoveryRoot\repair-result.ini"
  StrCpy $RelayRepairResultNew "$RelayRecoveryRoot\repair-result.ini.new"
  Delete "$RelayRoot\bootstrap-error.ini"

  CreateDirectory "$RelayRuntimeRoot"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not create its local runtime folder."
    Goto BootstrapFailed
  System::Call 'kernel32::GetFileAttributesW(w "$RelayRuntimeRoot") i.r0'
  ${If} $0 == -1
    StrCpy $RelayFailureMessage "Relay could not inspect its local runtime folder."
    Goto BootstrapFailed
  ${EndIf}
  IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
  ${If} $1 != 0
    StrCpy $RelayFailureMessage "Relay cannot prepare inside a redirected runtime folder."
    Goto BootstrapFailed
  ${EndIf}

  SetOutPath "$PLUGINSDIR"
  !ifdef COMPRESS
    SetCompress off
  !endif
  File /oname=$PLUGINSDIR\${RELAY_LAUNCHER_FILE} "${PROJECT_DIR}\release\windows-bootstrap\${RELAY_LAUNCHER_FILE}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif

  ReadINIStr $RelayStateProtocol "$RelayState" "Relay" "protocol"
  ${If} $RelayStateProtocol == "${RELAY_LEGACY_STATE_PROTOCOL}"
    ReadINIStr $RelayCurrent "$RelayState" "Relay" "current"
    !insertmacro RelayValidateBuildId "$RelayCurrent" $RelayBuildIsValid
    ${If} $RelayBuildIsValid != "1"
      StrCpy $RelayCurrent ""
    ${EndIf}
    ReadINIStr $RelayPrevious "$RelayState" "Relay" "previous"
    !insertmacro RelayValidateBuildId "$RelayPrevious" $RelayBuildIsValid
    ${If} $RelayBuildIsValid != "1"
      StrCpy $RelayPrevious ""
    ${EndIf}
    StrCpy $RelayPrevious1 ""
    StrCpy $RelayPrevious2 ""
  ${ElseIf} $RelayStateProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
    ReadINIStr $RelayCurrent "$RelayState" "Relay" "current"
    !insertmacro RelayValidateBuildId "$RelayCurrent" $RelayBuildIsValid
    ${If} $RelayBuildIsValid != "1"
      StrCpy $RelayCurrent ""
    ${EndIf}
    ReadINIStr $RelayPrevious "$RelayState" "Relay" "previous0"
    !insertmacro RelayValidateBuildId "$RelayPrevious" $RelayBuildIsValid
    ${If} $RelayBuildIsValid != "1"
      StrCpy $RelayPrevious ""
    ${EndIf}
    ReadINIStr $RelayPrevious1 "$RelayState" "Relay" "previous1"
    !insertmacro RelayValidateBuildId "$RelayPrevious1" $RelayBuildIsValid
    ${If} $RelayBuildIsValid != "1"
      StrCpy $RelayPrevious1 ""
    ${EndIf}
    ReadINIStr $RelayPrevious2 "$RelayState" "Relay" "previous2"
    !insertmacro RelayValidateBuildId "$RelayPrevious2" $RelayBuildIsValid
    ${If} $RelayBuildIsValid != "1"
      StrCpy $RelayPrevious2 ""
    ${EndIf}
  ${Else}
    StrCpy $RelayCurrent ""
    StrCpy $RelayPrevious ""
    StrCpy $RelayPrevious1 ""
    StrCpy $RelayPrevious2 ""
  ${EndIf}

  ${If} $RelayTransactionId != ""
    ${If} $RelayCurrent == ""
      StrCpy $RelayFailureMessage "Relay could not bind recovery to its current runtime."
      Goto BootstrapFailed
    ${EndIf}
    System::Call 'kernel32::GetFileAttributesW(w "$RelayRecoveryRoot") i.r0'
    ${If} $0 == -1
      StrCpy $RelayFailureMessage "Relay could not find its private recovery request."
      Goto BootstrapFailed
    ${EndIf}
    IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
    ${If} $1 != 0
      StrCpy $RelayFailureMessage "Relay recovery metadata was redirected."
      Goto BootstrapFailed
    ${EndIf}
    ${If} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
      ReadINIStr $RelayRequestProtocol "$RelayRepairRequest" "RepairRequest" "protocol"
      ReadINIStr $RelayRequestTransaction "$RelayRepairRequest" "RepairRequest" "transactionId"
      ReadINIStr $RelayRepairSource "$RelayRepairRequest" "RepairRequest" "sourceBuildId"
      ReadINIStr $RelayRepairTarget "$RelayRepairRequest" "RepairRequest" "targetBuildId"
      ReadINIStr $RelayRepairVersion "$RelayRepairRequest" "RepairRequest" "targetVersion"
      ReadINIStr $RelayRepairCommit "$RelayRepairRequest" "RepairRequest" "targetCommitish"
      ReadINIStr $RelayRepairInstallerHash "$RelayRepairRequest" "RepairRequest" "targetInstallerSha256"
      ReadINIStr $RelayRepairCheckpoint "$RelayRepairRequest" "RepairRequest" "checkpoint"
      ReadINIStr $RelayRepairRequestedAt "$RelayRepairRequest" "RepairRequest" "requestedAt"
      ${StdUtils.HashFile} $RelaySelfHash "SHA2-256" "$EXEPATH"
      !insertmacro RelayValidateBuildId "$RelayRepairTarget" $RelayBuildIsValid
      StrCpy $RelayResult "0"
      ${If} $RelayRepairTarget == "$RelayPrevious"
      ${OrIf} $RelayRepairTarget == "$RelayPrevious1"
      ${OrIf} $RelayRepairTarget == "$RelayPrevious2"
        StrCpy $RelayResult "1"
      ${EndIf}
      ReadINIStr $RelayRepairCatalogVersion "$RelayState" "Build.$RelayRepairTarget" "version"
      ReadINIStr $RelayRepairCatalogReleaseTag "$RelayState" "Build.$RelayRepairTarget" "releaseTag"
      ReadINIStr $RelayRepairCatalogCommit "$RelayState" "Build.$RelayRepairTarget" "targetCommitish"
      ReadINIStr $RelayRepairCatalogRuntimeHash "$RelayState" "Build.$RelayRepairTarget" "runtimeSha512"
      ReadINIStr $RelayRepairCatalogInstallerHash "$RelayState" "Build.$RelayRepairTarget" "installerSha256"
      ReadINIStr $RelayRepairCatalogProtocol "$RelayState" "Build.$RelayRepairTarget" "recoveryProtocol"
      ReadINIStr $RelayRepairCatalogServerEpoch "$RelayState" "Build.$RelayRepairTarget" "serverDataEpoch"
      ReadINIStr $RelayRepairCatalogClientEpoch "$RelayState" "Build.$RelayRepairTarget" "clientDataEpoch"
      ReadINIStr $RelayRepairCatalogHealth "$RelayState" "Build.$RelayRepairTarget" "health"
      ${If} $RelayStateProtocol != "${RELAY_RECOVERY_STATE_PROTOCOL}"
      ${OrIf} $RelayRequestProtocol != "${RELAY_RECOVERY_PROTOCOL}"
      ${OrIf} $RelayRequestTransaction != "$RelayTransactionId"
      ${OrIf} $RelayRepairSource != "$RelayCurrent"
      ${OrIf} $RelayBuildIsValid != "1"
      ${OrIf} $RelayResult != "1"
      ${OrIf} $RelayRepairTarget != "${RELAY_BUILD_ID}"
      ${OrIf} $RelayRepairVersion != "${RELAY_BUILD_VERSION}"
      ${OrIf} $RelayRepairCommit != "${RELAY_TARGET_COMMITISH}"
      ${OrIf} $RelayRepairInstallerHash != "$RelaySelfHash"
      ${OrIf} $RelayRepairCheckpoint != "pending"
      ${OrIf} $RelayRepairRequestedAt == ""
      ${OrIf} $RelayRepairCatalogVersion != "${RELAY_BUILD_VERSION}"
      ${OrIf} $RelayRepairCatalogReleaseTag != "v${RELAY_BUILD_VERSION}"
      ${OrIf} $RelayRepairCatalogCommit != "${RELAY_TARGET_COMMITISH}"
      ${OrIf} $RelayRepairCatalogRuntimeHash != "${APP_64_HASH}"
      ${OrIf} $RelayRepairCatalogProtocol != "${RELAY_RECOVERY_PROTOCOL}"
      ${OrIf} $RelayRepairCatalogServerEpoch != "${RELAY_SERVER_DATA_EPOCH}"
      ${OrIf} $RelayRepairCatalogClientEpoch != "${RELAY_CLIENT_DATA_EPOCH}"
      ${OrIf} $RelayRepairCatalogHealth != "healthy"
        StrCpy $RelayFailureMessage "Relay rejected mismatched retained-build repair metadata."
        Goto BootstrapFailed
      ${EndIf}
      ${If} $RelayRepairCatalogInstallerHash != ""
      ${AndIf} $RelayRepairCatalogInstallerHash != "$RelaySelfHash"
        StrCpy $RelayFailureMessage "Relay rejected a changed retained-build installer."
        Goto BootstrapFailed
      ${EndIf}
    ${Else}
      ReadINIStr $RelayRequestProtocol "$RelayRequest" "RecoveryRequest" "protocol"
      ReadINIStr $RelayRequestTransaction "$RelayRequest" "RecoveryRequest" "transactionId"
      ReadINIStr $RelayRequestTargetVersion "$RelayRequest" "RecoveryRequest" "targetVersion"
      ReadINIStr $RelayRequestTargetCommitish "$RelayRequest" "RecoveryRequest" "targetCommitish"
      ReadINIStr $RelayRequestInstallerHash "$RelayRequest" "RecoveryRequest" "targetInstallerSha256"
      ReadINIStr $RelayRequestCheckpoint "$RelayRequest" "RecoveryRequest" "checkpoint"
      ReadINIStr $RelayRequestSnapshotId "$RelayRequest" "RecoveryRequest" "snapshotId"
      ReadINIStr $RelayRequestMode "$RelayRequest" "RecoveryRequest" "mode"
      ReadINIStr $RelayRequestRequestedAt "$RelayRequest" "RecoveryRequest" "requestedAt"
      ReadINIStr $RelayRequestSourceBuild "$RelayRequest" "Source" "buildId"
      ${StdUtils.HashFile} $RelaySelfHash "SHA2-256" "$EXEPATH"
      ${If} $RelayRequestProtocol != "${RELAY_RECOVERY_PROTOCOL}"
      ${OrIf} $RelayRequestTransaction != "$RelayTransactionId"
      ${OrIf} $RelayRequestTargetVersion != "${RELAY_BUILD_VERSION}"
      ${OrIf} $RelayRequestTargetCommitish != "${RELAY_TARGET_COMMITISH}"
      ${OrIf} $RelayRequestInstallerHash != "$RelaySelfHash"
      ${OrIf} $RelayRequestCheckpoint != "pending"
      ${OrIf} $RelayRequestSnapshotId != ""
      ${OrIf} $RelayRequestSourceBuild != "$RelayCurrent"
        StrCpy $RelayFailureMessage "Relay rejected mismatched recovery update metadata."
        Goto BootstrapFailed
      ${EndIf}
    ${EndIf}
  ${EndIf}

  StrCpy $RelayMarker "$RelayFinalRuntime\${RELAY_RUNTIME_MARKER}"
  ReadINIStr $RelayMarkerProtocol "$RelayMarker" "Relay" "protocol"
  ReadINIStr $RelayMarkerBuildId "$RelayMarker" "Relay" "buildId"
  ReadINIStr $RelayMarkerExecutable "$RelayMarker" "Relay" "executable"
  ReadINIStr $RelayMarkerPayloadHash "$RelayMarker" "Relay" "payloadHash"
  StrCpy $RelayResult "0"
  ${If} ${FileExists} "$RelayFinalRuntime\${APP_EXECUTABLE_FILENAME}"
    System::Call 'kernel32::GetBinaryTypeW(w "$RelayFinalRuntime\${APP_EXECUTABLE_FILENAME}", *i .r0) i.r1'
    StrCpy $RelayResult $1
  ${EndIf}
  ${If} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${AndIf} $RelayMarkerBuildId == "${RELAY_BUILD_ID}"
  ${AndIf} $RelayMarkerExecutable == "${APP_EXECUTABLE_FILENAME}"
  ${AndIf} $RelayMarkerPayloadHash == "${APP_64_HASH}"
  ${AndIf} $RelayResult != "0"
    Goto RuntimeReady
  ${EndIf}

  Banner::show /NOUNLOAD "Preparing Relay..."
  StrCpy $RelayBannerVisible "1"
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  System::Call 'kernel32::GetTickCount() i.r1'
  StrCpy $RelayStaging "$RelayRuntimeRoot\.staging-${RELAY_BUILD_ID}-$0-$1"
  System::Call 'kernel32::CreateDirectoryW(w "$RelayStaging", p 0) i.r2'
  ${If} $2 == 0
    StrCpy $RelayFailureMessage "Relay could not create a staging folder."
    Goto BootstrapFailed
  ${EndIf}

  SetOutPath "$PLUGINSDIR"
  !ifdef COMPRESS
    SetCompress off
  !endif
  File /oname=$PLUGINSDIR\relay-app.7z "${APP_64}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif

  ${StdUtils.HashFile} $RelayArchiveHash "SHA2-512" "$PLUGINSDIR\relay-app.7z"
  ${If} $RelayArchiveHash != "${APP_64_HASH}"
    StrCpy $RelayFailureMessage "Relay could not verify the embedded runtime archive."
    Goto BootstrapFailed
  ${EndIf}

  Push $OUTDIR
  SetOutPath "$RelayStaging"
  Nsis7z::Extract "$PLUGINSDIR\relay-app.7z"
  Pop $RelayResult
  SetOutPath "$RelayResult"
  !insertmacro RelayHarnessFail ".fail-after-extraction" "Relay harness stopped after extraction."

  ${IfNot} ${FileExists} "$RelayStaging\${APP_EXECUTABLE_FILENAME}"
    StrCpy $RelayFailureMessage "The prepared Relay runtime is incomplete."
    Goto BootstrapFailed
  ${EndIf}
  System::Call 'kernel32::GetBinaryTypeW(w "$RelayStaging\${APP_EXECUTABLE_FILENAME}", *i .r0) i.r1'
  ${If} $1 == 0
    StrCpy $RelayFailureMessage "The prepared Relay executable is not a valid Windows binary."
    Goto BootstrapFailed
  ${EndIf}

  StrCpy $RelayMarker "$RelayStaging\${RELAY_RUNTIME_MARKER}"
  ClearErrors
  WriteINIStr "$RelayMarker" "Relay" "protocol" "${RELAY_RECOVERY_STATE_PROTOCOL}"
  WriteINIStr "$RelayMarker" "Relay" "buildId" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayMarker" "Relay" "executable" "${APP_EXECUTABLE_FILENAME}"
  WriteINIStr "$RelayMarker" "Relay" "payloadHash" "${APP_64_HASH}"
  WriteINIStr "$RelayMarker" "Relay" "version" "${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayMarker" "Relay" "releaseTag" "v${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayMarker" "Relay" "targetCommitish" "${RELAY_TARGET_COMMITISH}"
  WriteINIStr "$RelayMarker" "Relay" "serverDataEpoch" "${RELAY_SERVER_DATA_EPOCH}"
  WriteINIStr "$RelayMarker" "Relay" "clientDataEpoch" "${RELAY_CLIENT_DATA_EPOCH}"
  WriteINIStr "$RelayMarker" "Relay" "installedAt" "${RELAY_PACKAGED_AT}"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not finalize the new runtime."
    Goto BootstrapFailed
  !insertmacro RelayHarnessFail ".fail-after-marker" "Relay harness stopped after marker creation."

  System::Call 'kernel32::GetFileAttributesW(w "$RelayStaging") i.r0'
  ${If} $0 == -1
    StrCpy $RelayFailureMessage "Relay could not inspect the prepared runtime."
    Goto BootstrapFailed
  ${EndIf}
  IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
  ${If} $1 != 0
    StrCpy $RelayFailureMessage "Relay could not safely activate the prepared runtime."
    Goto BootstrapFailed
  ${EndIf}
  !insertmacro RelayHarnessFail ".fail-before-runtime-rename" "Relay harness stopped before runtime activation."
  System::Call 'kernel32::GetFileAttributesW(w "$RelayFinalRuntime") i.r0'
  StrCpy $RelayQuarantineActive "0"
  ${If} $0 != -1
    System::Call 'kernel32::GetCurrentProcessId() i.r1'
    System::Call 'kernel32::GetTickCount() i.r2'
    StrCpy $RelayQuarantine "$RelayRuntimeRoot\.corrupt-${RELAY_BUILD_ID}-$1-$2"
    System::Call 'kernel32::GetFileAttributesW(w "$RelayQuarantine") i.r0'
    ${If} $0 != -1
      StrCpy $RelayFailureMessage "Relay could not reserve a safe repair location."
      Goto BootstrapFailed
    ${EndIf}
    ClearErrors
    Rename "$RelayFinalRuntime" "$RelayQuarantine"
    IfErrors 0 +3
      StrCpy $RelayFailureMessage "Relay could not quarantine its damaged runtime."
      Goto BootstrapFailed
    StrCpy $RelayQuarantineActive "1"
    ClearErrors
    FileOpen $RelayQuarantineMarkerHandle "$RelayQuarantine\.relay-quarantine-created" w
    ${If} ${Errors}
      ClearErrors
      Rename "$RelayQuarantine" "$RelayFinalRuntime"
      ${IfNot} ${Errors}
        StrCpy $RelayQuarantineActive "0"
      ${EndIf}
      StrCpy $RelayFailureMessage "Relay could not mark its damaged runtime quarantine."
      Goto BootstrapFailed
    ${EndIf}
    FileClose $RelayQuarantineMarkerHandle
    !insertmacro RelayHarnessFail ".fail-after-quarantine" "Relay harness stopped after quarantining a damaged runtime."
  ${EndIf}

  ClearErrors
  Rename "$RelayStaging" "$RelayFinalRuntime"
  ${If} ${Errors}
    ${If} $RelayQuarantineActive == "1"
      ClearErrors
      Delete "$RelayQuarantine\.relay-quarantine-created"
      Rename "$RelayQuarantine" "$RelayFinalRuntime"
      ${IfNot} ${Errors}
        StrCpy $RelayQuarantineActive "0"
      ${EndIf}
    ${EndIf}
    StrCpy $RelayFailureMessage "Relay could not activate the prepared runtime folder."
    Goto BootstrapFailed
  ${EndIf}

RuntimeReady:
  ${If} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
    Goto WriteRepairReceipt
  ${EndIf}
  !insertmacro RelayHarnessFail ".fail-before-launcher-activation" "Relay harness stopped before launcher activation."
  Delete "$RelayLauncherNew"
  ${If} ${FileExists} "$RelayLauncher"
    ClearErrors
    ExecWait '"$RelayLauncher" ${RELAY_LAUNCHER_PROBE}' $RelayResult
    ${If} $RelayResult == ${RELAY_LAUNCHER_PROTOCOL_EXIT_CODE}
      Goto LauncherReady
    ${EndIf}
  ${EndIf}

  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\${RELAY_LAUNCHER_FILE}" "$RelayLauncherNew"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not prepare its stable launcher."
    Goto BootstrapFailed

  ExecWait '"$RelayLauncherNew" ${RELAY_LAUNCHER_PROBE}' $RelayResult
  ${If} $RelayResult != ${RELAY_LAUNCHER_PROTOCOL_EXIT_CODE}
    StrCpy $RelayFailureMessage "Relay could not verify its stable launcher."
    Goto BootstrapFailed
  ${EndIf}

  System::Call 'kernel32::MoveFileExW(w "$RelayLauncherNew", w "$RelayLauncher", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not install its stable launcher."
    Goto BootstrapFailed
  ${EndIf}

LauncherReady:
  ${If} $RelayTransactionId != ""
    Goto WritePreparedReceipt
  ${EndIf}
  ${If} $RelayCurrent == ""
    Goto ActivateFreshRecoveryState
  ${EndIf}
  ${If} $RelayCurrent == "${RELAY_BUILD_ID}"
    Goto ShortcutsReady
  ${EndIf}
  ${If} $RelayStateProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
    StrCpy $RelayFailureMessage "Use Relay's update or recovery screen to change a protected runtime."
    Goto BootstrapFailed
  ${EndIf}

  Delete "$RelayStateNew"
  ClearErrors
  WriteINIStr "$RelayStateNew" "Relay" "protocol" "${RELAY_LEGACY_STATE_PROTOCOL}"
  WriteINIStr "$RelayStateNew" "Relay" "current" "${RELAY_BUILD_ID}"
  StrCpy $RelayFallbackBuild ""
  !insertmacro RelayRuntimeIsUsable "$RelayCurrent" $RelayRuntimeIsUsable
  ${If} $RelayCurrent != "${RELAY_BUILD_ID}"
  ${AndIf} $RelayRuntimeIsUsable == "1"
    StrCpy $RelayFallbackBuild "$RelayCurrent"
  ${Else}
    !insertmacro RelayRuntimeIsUsable "$RelayPrevious" $RelayRuntimeIsUsable
    ${If} $RelayRuntimeIsUsable == "1"
      StrCpy $RelayFallbackBuild "$RelayPrevious"
    ${EndIf}
  ${EndIf}
  ${If} $RelayFallbackBuild != ""
    WriteINIStr "$RelayStateNew" "Relay" "previous" "$RelayFallbackBuild"
  ${EndIf}
  Goto ActivatePreparedState

ActivateFreshRecoveryState:
  Delete "$RelayStateNew"
  ClearErrors
  WriteINIStr "$RelayStateNew" "Relay" "protocol" "${RELAY_RECOVERY_STATE_PROTOCOL}"
  WriteINIStr "$RelayStateNew" "Relay" "generation" "1"
  WriteINIStr "$RelayStateNew" "Relay" "current" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayStateNew" "Relay" "candidate" ""
  WriteINIStr "$RelayStateNew" "Relay" "previous0" ""
  WriteINIStr "$RelayStateNew" "Relay" "previous1" ""
  WriteINIStr "$RelayStateNew" "Relay" "previous2" ""
  WriteINIStr "$RelayStateNew" "Relay" "failedReleaseFingerprints" ""
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "version" "${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "releaseTag" "v${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "targetCommitish" "${RELAY_TARGET_COMMITISH}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "runtimeSha512" "${APP_64_HASH}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "installerSha256" ""
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "recoveryProtocol" "${RELAY_RECOVERY_PROTOCOL}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "serverDataEpoch" "${RELAY_SERVER_DATA_EPOCH}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "clientDataEpoch" "${RELAY_CLIENT_DATA_EPOCH}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "installedAt" "${RELAY_PACKAGED_AT}"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "health" "healthy"
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "rollbackSnapshotId" ""

ActivatePreparedState:
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not prepare its runtime state."
    Goto BootstrapFailed

  !insertmacro RelayHarnessFail ".fail-before-state-activation" "Relay harness stopped before state activation."

  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not activate the prepared build."
    Goto BootstrapFailed
  ${EndIf}
  Goto ShortcutsReady

WritePreparedReceipt:
  Delete "$RelayPreparedNew"
  ClearErrors
  WriteINIStr "$RelayPreparedNew" "Prepared" "protocol" "${RELAY_RECOVERY_PROTOCOL}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "transactionId" "$RelayTransactionId"
  WriteINIStr "$RelayPreparedNew" "Prepared" "buildId" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "version" "${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "releaseTag" "v${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "targetCommitish" "${RELAY_TARGET_COMMITISH}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "runtimeSha512" "${APP_64_HASH}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "installerSha256" "$RelayRequestInstallerHash"
  WriteINIStr "$RelayPreparedNew" "Prepared" "recoveryProtocol" "${RELAY_RECOVERY_PROTOCOL}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "serverDataEpoch" "${RELAY_SERVER_DATA_EPOCH}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "clientDataEpoch" "${RELAY_CLIENT_DATA_EPOCH}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "preparedAt" "${RELAY_PACKAGED_AT}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "health" "candidate"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not write its prepared recovery receipt."
    Goto BootstrapFailed
  System::Call 'kernel32::MoveFileExW(w "$RelayPreparedNew", w "$RelayPrepared", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not activate its prepared recovery receipt."
    Goto BootstrapFailed
  ${EndIf}
  Goto ShortcutsReady

WriteRepairReceipt:
  Delete "$RelayRepairResultNew"
  ClearErrors
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "protocol" "${RELAY_RECOVERY_PROTOCOL}"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "transactionId" "$RelayTransactionId"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "buildId" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "version" "${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "targetCommitish" "${RELAY_TARGET_COMMITISH}"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "runtimeSha512" "${APP_64_HASH}"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "installerSha256" "$RelayRepairInstallerHash"
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "completedAt" "$RelayRepairRequestedAt"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not write its retained-build repair receipt."
    Goto BootstrapFailed
  System::Call 'kernel32::MoveFileExW(w "$RelayRepairResultNew", w "$RelayRepairResult", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not activate its retained-build repair receipt."
    Goto BootstrapFailed
  ${EndIf}
  Delete "$RelayRepairRequest"
  ${If} $RelayBannerVisible == "1"
    Banner::destroy
    StrCpy $RelayBannerVisible "0"
  ${EndIf}
  SetErrorLevel 0
  Quit

ShortcutsReady:

  CreateDirectory "$SMPROGRAMS\Relay"
  ClearErrors
  CreateShortCut "$DESKTOP\Relay.lnk" "$RelayLauncher" "" "$RelayLauncher" 0 SW_SHOWNORMAL "" "Relay"
  CreateShortCut "$SMPROGRAMS\Relay\Relay.lnk" "$RelayLauncher" "" "$RelayLauncher" 0 SW_SHOWNORMAL "" "Relay"
  CreateShortCut "$SMPROGRAMS\Relay\Relay Recovery.lnk" "$RelayLauncher" "${RELAY_RECOVERY_ARGUMENT}" "$RelayLauncher" 0 SW_SHOWNORMAL "" "Relay Recovery"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Relay is ready, but Windows could not refresh one of its shortcuts."
  ${EndIf}

  ${If} $RelayBannerVisible == "1"
    Banner::destroy
    StrCpy $RelayBannerVisible "0"
  ${EndIf}

  ${If} $RelayPrepareOnly != "/relay-prepare-only"
  ${AndIf} $RelayRepairOnly != "${RELAY_REPAIR_ONLY_ARGUMENT}"
    SetOutPath "$RelayRoot"
    Exec '"$RelayLauncher" $RelayArgs'
  ${EndIf}
  SetErrorLevel 0
  Quit

BootstrapFailed:
  ${If} $RelayBannerVisible == "1"
    Banner::destroy
    StrCpy $RelayBannerVisible "0"
  ${EndIf}
  Delete "$RelayLauncherNew"
  Delete "$RelayStateNew"
  Delete "$RelayPreparedNew"
  Delete "$RelayRepairResultNew"
  ${If} $RelayQuarantineActive == "1"
    System::Call 'kernel32::GetFileAttributesW(w "$RelayFinalRuntime") i.r0'
    ${If} $0 == -1
      ClearErrors
      Delete "$RelayQuarantine\.relay-quarantine-created"
      Rename "$RelayQuarantine" "$RelayFinalRuntime"
      ${IfNot} ${Errors}
        StrCpy $RelayQuarantineActive "0"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  WriteINIStr "$RelayRoot\bootstrap-error.ini" "Relay" "message" "$RelayFailureMessage"
  ${If} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
    Delete "$RelayRepairRequest"
  ${EndIf}
  ${If} $RelayPrepareOnly != "/relay-prepare-only"
  ${AndIf} $RelayRepairOnly != "${RELAY_REPAIR_ONLY_ARGUMENT}"
    MessageBox MB_OK|MB_ICONSTOP "$RelayFailureMessage Relay will try the last usable build."
  ${EndIf}
  ${If} $RelayPrepareOnly != "/relay-prepare-only"
  ${AndIf} $RelayRepairOnly != "${RELAY_REPAIR_ONLY_ARGUMENT}"
  ${AndIf} ${FileExists} "$RelayLauncher"
    Exec '"$RelayLauncher" $RelayArgs'
  ${EndIf}
  SetErrorLevel 1
  Quit
SectionEnd
