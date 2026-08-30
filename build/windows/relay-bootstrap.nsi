!include "common.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "StdUtils.nsh"
!include "StrFunc.nsh"
!include "Win\WinError.nsh"
!include "${PROJECT_DIR}\build\windows\include\relay-runtime-contract.nsh"
!include "${PROJECT_DIR}\release\windows-bootstrap\relay-build.nsh"
Unicode true
${Using:StrFunc} StrCase
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
Var RelayPayloadHash
Var RelayMarkerInstallerHash
Var RelayMarkerHash
Var RelayExecutableHash
Var RelayD3dCompilerHash
Var RelayDxCompilerHash
Var RelayDxilHash
Var RelayFfmpegHash
Var RelayLibEglHash
Var RelayLibGlesV2Hash
Var RelayVkSwiftshaderHash
Var RelayVulkanHash
Var RelayAppAsarHash
Var RelayPocketBaseHash
Var RelayPocketBaseHookHash
Var RelayBetterSqlite3Hash
Var RelayKoffiHash
Var RelayContentIntegrity
Var RelayCatalogRuntimeHash
Var RelayBannerVisible
Var RelayFailureMessage
Var RelayLockHandle
Var RelayQuarantine
Var RelayQuarantineActive
Var RelayQuarantineMarkerHandle
Var RelayArchiveHash
Var RelayFallbackBuild
Var RelayRollbackRequest
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

Var RelayRequestNew
Var RelayStandaloneUpdate
Var RelaySourceVersion
Var RelaySourceReleaseTag
Var RelaySourceCommit
Var RelaySourceRuntimeHash
Var RelaySourceInstallerHash
Var RelaySourceRecoveryProtocol
Var RelaySourceServerEpoch
Var RelaySourceClientEpoch
Var RelaySourceInstalledAt
Var RelaySourceHealth
Var RelaySourceSnapshotId
Var RelayVersionCompare
Var RelayAppLockHandle
Var RelaySnapshotRoot
Var RelaySnapshotMarker
Var RelaySnapshotProtocol
Var RelaySnapshotId
Var RelaySnapshotTransaction
Var RelaySnapshotSource
Var RelaySnapshotEpoch
Var RelaySnapshotComplete
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

!macro RelayCompletedServerSnapshotIsUsable RESULT
  StrCpy ${RESULT} "0"
  !insertmacro RelayValidateTransactionId "$RelayRequestSnapshotId" $RelayTransactionIsValid
  ${If} $RelayTransactionIsValid == "1"
    StrCpy $RelaySnapshotRoot "$APPDATA\Relay\RecoverySnapshots\$RelayRequestSnapshotId"
    StrCpy $RelaySnapshotMarker "$RelaySnapshotRoot\snapshot.ini"
    System::Call 'kernel32::GetFileAttributesW(w "$RelaySnapshotRoot") i.r0'
    ${If} $0 != -1
      IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
      IntOp $2 $0 & 0x10
      ${If} $1 == 0
      ${AndIf} $2 != 0
        System::Call 'kernel32::GetFileAttributesW(w "$RelaySnapshotRoot\data") i.r0'
        ${If} $0 != -1
          IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
          IntOp $2 $0 & 0x10
          ${If} $1 == 0
          ${AndIf} $2 != 0
            System::Call 'kernel32::GetFileAttributesW(w "$RelaySnapshotMarker") i.r0'
            ${If} $0 != -1
              IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
              IntOp $2 $0 & 0x10
              ${If} $1 == 0
              ${AndIf} $2 == 0
                ReadINIStr $RelaySnapshotProtocol "$RelaySnapshotMarker" "Snapshot" "protocol"
                ReadINIStr $RelaySnapshotId "$RelaySnapshotMarker" "Snapshot" "snapshotId"
                ReadINIStr $RelaySnapshotTransaction "$RelaySnapshotMarker" "Snapshot" "transactionId"
                ReadINIStr $RelaySnapshotSource "$RelaySnapshotMarker" "Snapshot" "sourceBuildId"
                ReadINIStr $RelaySnapshotEpoch "$RelaySnapshotMarker" "Snapshot" "dataEpoch"
                ReadINIStr $RelaySnapshotComplete "$RelaySnapshotMarker" "Snapshot" "complete"
                ${If} $RelaySnapshotProtocol == "1"
                ${AndIf} $RelaySnapshotId == "$RelayRequestSnapshotId"
                ${AndIf} $RelaySnapshotTransaction == "$RelayTransactionId"
                ${AndIf} $RelaySnapshotSource == "$RelayCurrent"
                ${AndIf} $RelaySnapshotEpoch == "$RelaySourceServerEpoch"
                ${AndIf} $RelaySnapshotComplete == "1"
                  StrCpy ${RESULT} "1"
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
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
    StrCpy $RelayMarkerHash ""
    StrCpy $RelayContentIntegrity "0"
    ${If} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
      ${StdUtils.HashFile} $RelayMarkerHash "SHA2-512" "$RelayMarker"
      ${StrCase} $RelayMarkerHash $RelayMarkerHash "L"
      !insertmacro RelayVerifyRuntimeContent "$RelayRuntimeRoot\${BUILD_ID}" "$RelayMarker" $RelayContentIntegrity
      ReadINIStr $RelayCatalogRuntimeHash "$RelayState" "Build.${BUILD_ID}" "runtimeSha512"
    ${EndIf}
    StrLen $RelayPayloadHashLength $RelayMarkerPayloadHash
    ${StrFilter} "$RelayMarkerPayloadHash" "" "0123456789abcdefABCDEF" "" $RelayPayloadHashFiltered
    StrCpy $RelayResult "0"
    ${If} ${FileExists} "$RelayRuntimeRoot\${BUILD_ID}\${APP_EXECUTABLE_FILENAME}"
      System::Call 'kernel32::GetBinaryTypeW(w "$RelayRuntimeRoot\${BUILD_ID}\${APP_EXECUTABLE_FILENAME}", *i .r0) i.r1'
      StrCpy $RelayResult $1
    ${EndIf}
    ${If} $RelayMarkerProtocol == "${RELAY_LEGACY_STATE_PROTOCOL}"
      ${If} $RelayMarkerBuildId == "${BUILD_ID}"
      ${AndIf} $RelayMarkerExecutable == "${APP_EXECUTABLE_FILENAME}"
      ${AndIf} $RelayPayloadHashLength == 128
      ${AndIf} $RelayPayloadHashFiltered == $RelayMarkerPayloadHash
      ${AndIf} $RelayResult != "0"
        StrCpy ${RESULT} "1"
      ${EndIf}
    ${ElseIf} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
      ${If} $RelayMarkerBuildId == "${BUILD_ID}"
      ${AndIf} $RelayMarkerExecutable == "${APP_EXECUTABLE_FILENAME}"
      ${AndIf} $RelayPayloadHashLength == 128
      ${AndIf} $RelayPayloadHashFiltered == $RelayMarkerPayloadHash
      ${AndIf} $RelayContentIntegrity == "1"
      ${AndIf} $RelayResult != "0"
        ${If} $RelayCatalogRuntimeHash == ""
        ${OrIf} $RelayCatalogRuntimeHash == $RelayMarkerHash
          StrCpy ${RESULT} "1"
        ${EndIf}
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
  StrCpy $RelayRequestNew "$RelayRecoveryRoot\update-request.ini.new"
  StrCpy $RelayPrepared "$RelayRecoveryRoot\prepared.ini"
  StrCpy $RelayRollbackRequest "$RelayRecoveryRoot\rollback-request.ini"
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

  StrCpy $RelayStandaloneUpdate "0"
  ${If} $RelayTransactionId == ""
  ${AndIf} $RelayArgs == ""
  ${AndIf} $RelayStateProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${AndIf} $RelayCurrent != ""
  ${AndIf} $RelayCurrent != "${RELAY_BUILD_ID}"
    Goto PrepareStandaloneRecoveryUpdate
  ${EndIf}
  Goto StandaloneRecoveryUpdateReady

PrepareStandaloneRecoveryUpdate:
  ReadINIStr $RelayResult "$RelayState" "Relay" "candidate"
  ${If} $RelayResult != ""
    StrCpy $RelayFailureMessage "Relay already has a protected recovery transaction in progress."
    Goto BootstrapFailed
  ${EndIf}
  ${If} ${FileExists} "$RelayRollbackRequest"
  ${OrIf} ${FileExists} "$RelayRepairRequest"
    StrCpy $RelayFailureMessage "Relay already has protected recovery metadata in progress."
    Goto BootstrapFailed
  ${EndIf}

  ReadINIStr $RelaySourceVersion "$RelayState" "Build.$RelayCurrent" "version"
  ReadINIStr $RelaySourceReleaseTag "$RelayState" "Build.$RelayCurrent" "releaseTag"
  ReadINIStr $RelaySourceCommit "$RelayState" "Build.$RelayCurrent" "targetCommitish"
  ReadINIStr $RelaySourceRuntimeHash "$RelayState" "Build.$RelayCurrent" "runtimeSha512"
  ReadINIStr $RelaySourceInstallerHash "$RelayState" "Build.$RelayCurrent" "installerSha256"
  ReadINIStr $RelaySourceRecoveryProtocol "$RelayState" "Build.$RelayCurrent" "recoveryProtocol"
  ReadINIStr $RelaySourceServerEpoch "$RelayState" "Build.$RelayCurrent" "serverDataEpoch"
  ReadINIStr $RelaySourceClientEpoch "$RelayState" "Build.$RelayCurrent" "clientDataEpoch"
  ReadINIStr $RelaySourceInstalledAt "$RelayState" "Build.$RelayCurrent" "installedAt"
  ReadINIStr $RelaySourceHealth "$RelayState" "Build.$RelayCurrent" "health"
  ReadINIStr $RelaySourceSnapshotId "$RelayState" "Build.$RelayCurrent" "rollbackSnapshotId"
  ${VersionCompare} $RelaySourceVersion "${RELAY_BUILD_VERSION}" $RelayVersionCompare
  ${If} $RelayVersionCompare != "2"
    StrCpy $RelayFailureMessage "Relay accepts only a newer standalone release. Use Recovery to select an older build."
    Goto BootstrapFailed
  ${EndIf}
  ${If} $RelaySourceHealth != "healthy"
  ${OrIf} $RelaySourceSnapshotId != ""
  ${OrIf} $RelaySourceRecoveryProtocol != "${RELAY_RECOVERY_PROTOCOL}"
  ${OrIf} $RelaySourceServerEpoch != "${RELAY_SERVER_DATA_EPOCH}"
  ${OrIf} $RelaySourceClientEpoch != "${RELAY_CLIENT_DATA_EPOCH}"
    StrCpy $RelayFailureMessage "Relay cannot safely hand off this protected runtime to the selected release."
    Goto BootstrapFailed
  ${EndIf}

  System::Call 'kernel32::CreateFileW(w "$APPDATA\Relay\lockfile", i 0xC0000000, i 0, p 0, i 4, i 0x80, p 0) p.r0'
  StrCpy $RelayAppLockHandle $0
  ${If} $RelayAppLockHandle == -1
    StrCpy $RelayFailureMessage "Close Relay completely before running the installer."
    Goto BootstrapFailed
  ${EndIf}

  ClearErrors
  CreateDirectory "$RelayRecoveryRoot"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not create its private recovery directory."
    Goto BootstrapFailed
  System::Call 'kernel32::GetFileAttributesW(w "$RelayRecoveryRoot") i.r0'
  IntOp $1 $0 & ${FILE_ATTRIBUTE_REPARSE_POINT}
  ${If} $0 == -1
  ${OrIf} $1 != 0
    StrCpy $RelayFailureMessage "Relay recovery metadata was redirected."
    Goto BootstrapFailed
  ${EndIf}
  ${StdUtils.HashFile} $RelaySelfHash "SHA2-256" "$EXEPATH"
  ${If} ${FileExists} "$RelayRequest"
    ReadINIStr $RelayRequestProtocol "$RelayRequest" "RecoveryRequest" "protocol"
    ReadINIStr $RelayRequestTransaction "$RelayRequest" "RecoveryRequest" "transactionId"
    ReadINIStr $RelayRequestTargetVersion "$RelayRequest" "RecoveryRequest" "targetVersion"
    ReadINIStr $RelayRequestTargetCommitish "$RelayRequest" "RecoveryRequest" "targetCommitish"
    ReadINIStr $RelayRequestInstallerHash "$RelayRequest" "RecoveryRequest" "targetInstallerSha256"
    ReadINIStr $RelayRequestSourceBuild "$RelayRequest" "Source" "buildId"
    !insertmacro RelayValidateTransactionId "$RelayRequestTransaction" $RelayTransactionIsValid
    ${If} $RelayRequestProtocol != "${RELAY_RECOVERY_PROTOCOL}"
    ${OrIf} $RelayTransactionIsValid != "1"
    ${OrIf} $RelayRequestTargetVersion != "${RELAY_BUILD_VERSION}"
    ${OrIf} $RelayRequestTargetCommitish != "${RELAY_TARGET_COMMITISH}"
    ${OrIf} $RelayRequestInstallerHash != "$RelaySelfHash"
    ${OrIf} $RelayRequestSourceBuild != "$RelayCurrent"
      StrCpy $RelayFailureMessage "Relay found protected update metadata for a different immutable release."
      Goto BootstrapFailed
    ${EndIf}
    Goto ResumeStandaloneRecoveryUpdate
  ${EndIf}
  ${If} ${FileExists} "$RelayPrepared"
    Delete "$RelayPrepared"
  ${EndIf}
  Goto CreateStandaloneRecoveryUpdate

ResumeStandaloneRecoveryUpdate:
  StrCpy $RelayTransactionId $RelayRequestTransaction
  StrCpy $RelayStandaloneUpdate "1"
  Goto StandaloneRecoveryUpdateReady

CreateStandaloneRecoveryUpdate:

  System::Call 'ole32::CoCreateGuid(g .r0) i.r1'
  ${If} $1 != 0
    StrCpy $RelayFailureMessage "Relay could not create a protected update identity."
    Goto BootstrapFailed
  ${EndIf}
  StrCpy $RelayTransactionId $0 -1 1
  ${StrCase} $RelayTransactionId $RelayTransactionId "L"
  !insertmacro RelayValidateTransactionId "$RelayTransactionId" $RelayTransactionIsValid
  ${If} $RelayTransactionIsValid != "1"
    StrCpy $RelayFailureMessage "Relay created an invalid protected update identity."
    Goto BootstrapFailed
  ${EndIf}


  Delete "$RelayRequestNew"
  ClearErrors
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "protocol" "${RELAY_RECOVERY_PROTOCOL}"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "transactionId" "$RelayTransactionId"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "targetVersion" "${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "targetCommitish" "${RELAY_TARGET_COMMITISH}"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "targetInstallerSha256" "$RelaySelfHash"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "mode" "unconfigured"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "checkpoint" "pending"
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "snapshotId" ""
  WriteINIStr "$RelayRequestNew" "RecoveryRequest" "requestedAt" "${RELAY_PACKAGED_AT}"
  WriteINIStr "$RelayRequestNew" "Source" "buildId" "$RelayCurrent"
  WriteINIStr "$RelayRequestNew" "Source" "version" "$RelaySourceVersion"
  WriteINIStr "$RelayRequestNew" "Source" "releaseTag" "$RelaySourceReleaseTag"
  WriteINIStr "$RelayRequestNew" "Source" "targetCommitish" "$RelaySourceCommit"
  WriteINIStr "$RelayRequestNew" "Source" "runtimeSha512" "$RelaySourceRuntimeHash"
  WriteINIStr "$RelayRequestNew" "Source" "installerSha256" "$RelaySourceInstallerHash"
  WriteINIStr "$RelayRequestNew" "Source" "recoveryProtocol" "$RelaySourceRecoveryProtocol"
  WriteINIStr "$RelayRequestNew" "Source" "serverDataEpoch" "$RelaySourceServerEpoch"
  WriteINIStr "$RelayRequestNew" "Source" "clientDataEpoch" "$RelaySourceClientEpoch"
  WriteINIStr "$RelayRequestNew" "Source" "installedAt" "$RelaySourceInstalledAt"
  WriteINIStr "$RelayRequestNew" "Source" "health" "$RelaySourceHealth"
  WriteINIStr "$RelayRequestNew" "Source" "rollbackSnapshotId" "$RelaySourceSnapshotId"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not write its protected update request."
    Goto BootstrapFailed
  System::Call 'kernel32::MoveFileExW(w "$RelayRequestNew", w "$RelayRequest", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not activate its protected update request."
    Goto BootstrapFailed
  ${EndIf}
  !insertmacro RelayHarnessFail ".fail-after-standalone-request" "Relay harness stopped after standalone request activation."
  StrCpy $RelayStandaloneUpdate "1"

StandaloneRecoveryUpdateReady:

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
      ${OrIf} $RelayRequestSourceBuild != "$RelayCurrent"
        StrCpy $RelayFailureMessage "Relay rejected mismatched recovery update metadata."
        Goto BootstrapFailed
      ${EndIf}
      ${If} $RelayStandaloneUpdate == "1"
        ${If} $RelayRequestCheckpoint == "pending"
          ${If} $RelayRequestMode != "unconfigured"
          ${OrIf} $RelayRequestSnapshotId != ""
            StrCpy $RelayFailureMessage "Relay rejected an invalid pending standalone update."
            Goto BootstrapFailed
          ${EndIf}
        ${ElseIf} $RelayRequestCheckpoint == "complete"
          ${If} $RelayRequestMode == "server"
            !insertmacro RelayCompletedServerSnapshotIsUsable $RelayResult
            ${If} $RelayResult != "1"
              StrCpy $RelayFailureMessage "Relay rejected a missing or mismatched completed server snapshot."
              Goto BootstrapFailed
            ${EndIf}
          ${ElseIf} $RelayRequestMode == "client"
          ${OrIf} $RelayRequestMode == "unconfigured"
            ${If} $RelayRequestSnapshotId != ""
              StrCpy $RelayFailureMessage "Relay rejected an invalid completed standalone update."
              Goto BootstrapFailed
            ${EndIf}
          ${Else}
            StrCpy $RelayFailureMessage "Relay rejected an invalid completed standalone update."
            Goto BootstrapFailed
          ${EndIf}
        ${Else}
          StrCpy $RelayFailureMessage "Relay rejected an invalid standalone checkpoint state."
          Goto BootstrapFailed
        ${EndIf}
      ${ElseIf} $RelayRequestCheckpoint != "pending"
      ${OrIf} $RelayRequestSnapshotId != ""
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
  ReadINIStr $RelayMarkerInstallerHash "$RelayMarker" "Relay" "installerSha256"
  ${StdUtils.HashFile} $RelayMarkerHash "SHA2-512" "$RelayMarker"
  ${StrCase} $RelayMarkerHash $RelayMarkerHash "L"
  !insertmacro RelayVerifyRuntimeContent "$RelayFinalRuntime" "$RelayMarker" $RelayContentIntegrity
  StrCpy $RelayResult "0"
  ${If} ${FileExists} "$RelayFinalRuntime\${APP_EXECUTABLE_FILENAME}"
    System::Call 'kernel32::GetBinaryTypeW(w "$RelayFinalRuntime\${APP_EXECUTABLE_FILENAME}", *i .r0) i.r1'
    StrCpy $RelayResult $1
  ${EndIf}
  ${If} $RelayMarkerProtocol == "${RELAY_RECOVERY_STATE_PROTOCOL}"
  ${AndIf} $RelayMarkerBuildId == "${RELAY_BUILD_ID}"
  ${AndIf} $RelayMarkerExecutable == "${APP_EXECUTABLE_FILENAME}"
  ${AndIf} $RelayMarkerPayloadHash == "${APP_64_HASH}"
  ${AndIf} $RelayContentIntegrity == "1"
  ${AndIf} $RelayResult != "0"
    ${If} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
      ${If} $RelayRepairCatalogRuntimeHash == $RelayMarkerHash
        Goto RuntimeReady
      ${EndIf}
    ${ElseIf} $RelayTransactionId != ""
      ${If} $RelayMarkerInstallerHash == $RelayRequestInstallerHash
        Goto RuntimeReady
      ${EndIf}
    ${Else}
      Goto RuntimeReady
    ${EndIf}
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
  ${StdUtils.HashFile} $RelayExecutableHash "SHA2-512" "$RelayStaging\${APP_EXECUTABLE_FILENAME}"
  ${StrCase} $RelayExecutableHash $RelayExecutableHash "L"
  ${StdUtils.HashFile} $RelayD3dCompilerHash "SHA2-512" "$RelayStaging\${RELAY_D3D_COMPILER_DLL}"
  ${StrCase} $RelayD3dCompilerHash $RelayD3dCompilerHash "L"
  ${StdUtils.HashFile} $RelayDxCompilerHash "SHA2-512" "$RelayStaging\${RELAY_DX_COMPILER_DLL}"
  ${StrCase} $RelayDxCompilerHash $RelayDxCompilerHash "L"
  ${StdUtils.HashFile} $RelayDxilHash "SHA2-512" "$RelayStaging\${RELAY_DXIL_DLL}"
  ${StrCase} $RelayDxilHash $RelayDxilHash "L"
  ${StdUtils.HashFile} $RelayFfmpegHash "SHA2-512" "$RelayStaging\${RELAY_FFMPEG_DLL}"
  ${StrCase} $RelayFfmpegHash $RelayFfmpegHash "L"
  ${StdUtils.HashFile} $RelayLibEglHash "SHA2-512" "$RelayStaging\${RELAY_LIB_EGL_DLL}"
  ${StrCase} $RelayLibEglHash $RelayLibEglHash "L"
  ${StdUtils.HashFile} $RelayLibGlesV2Hash "SHA2-512" "$RelayStaging\${RELAY_LIB_GLES_V2_DLL}"
  ${StrCase} $RelayLibGlesV2Hash $RelayLibGlesV2Hash "L"
  ${StdUtils.HashFile} $RelayVkSwiftshaderHash "SHA2-512" "$RelayStaging\${RELAY_VK_SWIFTSHADER_DLL}"
  ${StrCase} $RelayVkSwiftshaderHash $RelayVkSwiftshaderHash "L"
  ${StdUtils.HashFile} $RelayVulkanHash "SHA2-512" "$RelayStaging\${RELAY_VULKAN_DLL}"
  ${StrCase} $RelayVulkanHash $RelayVulkanHash "L"
  ${StdUtils.HashFile} $RelayAppAsarHash "SHA2-512" "$RelayStaging\${RELAY_APP_ASAR}"
  ${StrCase} $RelayAppAsarHash $RelayAppAsarHash "L"
  ${StdUtils.HashFile} $RelayPocketBaseHash "SHA2-512" "$RelayStaging\${RELAY_POCKETBASE_EXECUTABLE}"
  ${StrCase} $RelayPocketBaseHash $RelayPocketBaseHash "L"
  ${StdUtils.HashFile} $RelayPocketBaseHookHash "SHA2-512" "$RelayStaging\${RELAY_POCKETBASE_HOOK}"
  ${StrCase} $RelayPocketBaseHookHash $RelayPocketBaseHookHash "L"
  ${StdUtils.HashFile} $RelayBetterSqlite3Hash "SHA2-512" "$RelayStaging\${RELAY_BETTER_SQLITE3_NATIVE}"
  ${StrCase} $RelayBetterSqlite3Hash $RelayBetterSqlite3Hash "L"
  ${StdUtils.HashFile} $RelayKoffiHash "SHA2-512" "$RelayStaging\${RELAY_KOFFI_NATIVE}"
  ${StrCase} $RelayKoffiHash $RelayKoffiHash "L"
  ClearErrors
  WriteINIStr "$RelayMarker" "Relay" "protocol" "${RELAY_RECOVERY_STATE_PROTOCOL}"
  WriteINIStr "$RelayMarker" "Relay" "buildId" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayMarker" "Relay" "executable" "${APP_EXECUTABLE_FILENAME}"
  StrCpy $RelayPayloadHash "${APP_64_HASH}"
  ${StrCase} $RelayPayloadHash $RelayPayloadHash "L"
  WriteINIStr "$RelayMarker" "Relay" "payloadHash" "$RelayPayloadHash"
  WriteINIStr "$RelayMarker" "Relay" "version" "${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayMarker" "Relay" "releaseTag" "v${RELAY_BUILD_VERSION}"
  WriteINIStr "$RelayMarker" "Relay" "targetCommitish" "${RELAY_TARGET_COMMITISH}"
  WriteINIStr "$RelayMarker" "Relay" "serverDataEpoch" "${RELAY_SERVER_DATA_EPOCH}"
  WriteINIStr "$RelayMarker" "Relay" "clientDataEpoch" "${RELAY_CLIENT_DATA_EPOCH}"
  WriteINIStr "$RelayMarker" "Relay" "installedAt" "${RELAY_PACKAGED_AT}"
  ${If} $RelayRepairOnly != "${RELAY_REPAIR_ONLY_ARGUMENT}"
  ${AndIf} $RelayTransactionId != ""
    WriteINIStr "$RelayMarker" "Relay" "installerSha256" "$RelayRequestInstallerHash"
  ${EndIf}
  WriteINIStr "$RelayMarker" "Integrity" "executableSha512" "$RelayExecutableHash"
  WriteINIStr "$RelayMarker" "Integrity" "d3dCompilerSha512" "$RelayD3dCompilerHash"
  WriteINIStr "$RelayMarker" "Integrity" "dxCompilerSha512" "$RelayDxCompilerHash"
  WriteINIStr "$RelayMarker" "Integrity" "dxilSha512" "$RelayDxilHash"
  WriteINIStr "$RelayMarker" "Integrity" "ffmpegSha512" "$RelayFfmpegHash"
  WriteINIStr "$RelayMarker" "Integrity" "libEglSha512" "$RelayLibEglHash"
  WriteINIStr "$RelayMarker" "Integrity" "libGlesV2Sha512" "$RelayLibGlesV2Hash"
  WriteINIStr "$RelayMarker" "Integrity" "vkSwiftshaderSha512" "$RelayVkSwiftshaderHash"
  WriteINIStr "$RelayMarker" "Integrity" "vulkanSha512" "$RelayVulkanHash"
  WriteINIStr "$RelayMarker" "Integrity" "appAsarSha512" "$RelayAppAsarHash"
  WriteINIStr "$RelayMarker" "Integrity" "pocketbaseSha512" "$RelayPocketBaseHash"
  WriteINIStr "$RelayMarker" "Integrity" "pocketbaseHookSha512" "$RelayPocketBaseHookHash"
  WriteINIStr "$RelayMarker" "Integrity" "betterSqlite3Sha512" "$RelayBetterSqlite3Hash"
  WriteINIStr "$RelayMarker" "Integrity" "koffiSha512" "$RelayKoffiHash"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not finalize the new runtime."
    Goto BootstrapFailed
  !insertmacro RelayVerifyRuntimeContent "$RelayStaging" "$RelayMarker" $RelayContentIntegrity
  ${If} $RelayContentIntegrity != "1"
    StrCpy $RelayFailureMessage "Relay could not verify the extracted runtime contents."
    Goto BootstrapFailed
  ${EndIf}
  ${StdUtils.HashFile} $RelayMarkerHash "SHA2-512" "$RelayMarker"
  ${StrCase} $RelayMarkerHash $RelayMarkerHash "L"
  ${If} $RelayRepairOnly == "${RELAY_REPAIR_ONLY_ARGUMENT}"
    ${If} $RelayRepairCatalogRuntimeHash != $RelayMarkerHash
    ${AndIf} $RelayRepairCatalogInstallerHash != ""
      ClearErrors
      WriteINIStr "$RelayMarker" "Relay" "installerSha256" "$RelayRepairInstallerHash"
      IfErrors 0 +3
        StrCpy $RelayFailureMessage "Relay could not finalize the new runtime."
        Goto BootstrapFailed
      ${StdUtils.HashFile} $RelayMarkerHash "SHA2-512" "$RelayMarker"
      ${StrCase} $RelayMarkerHash $RelayMarkerHash "L"
    ${EndIf}
    ${If} $RelayRepairCatalogRuntimeHash != $RelayMarkerHash
      StrCpy $RelayFailureMessage "Relay rejected changed retained-build runtime contents."
      Goto BootstrapFailed
    ${EndIf}
  ${EndIf}
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
    StrCpy $RelayFailureMessage "Relay rejected an unbound protected runtime change."
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
  WriteINIStr "$RelayStateNew" "Build.${RELAY_BUILD_ID}" "runtimeSha512" "$RelayMarkerHash"
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
  WriteINIStr "$RelayPreparedNew" "Prepared" "runtimeSha512" "$RelayMarkerHash"
  WriteINIStr "$RelayPreparedNew" "Prepared" "installerSha256" "$RelayRequestInstallerHash"
  WriteINIStr "$RelayPreparedNew" "Prepared" "recoveryProtocol" "${RELAY_RECOVERY_PROTOCOL}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "serverDataEpoch" "${RELAY_SERVER_DATA_EPOCH}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "clientDataEpoch" "${RELAY_CLIENT_DATA_EPOCH}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "preparedAt" "${RELAY_PACKAGED_AT}"
  WriteINIStr "$RelayPreparedNew" "Prepared" "health" "candidate"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not write its prepared recovery receipt."
    Goto BootstrapFailed
  !insertmacro RelayHarnessFail ".fail-before-prepared-activation" "Relay harness stopped before prepared receipt activation."
  System::Call 'kernel32::MoveFileExW(w "$RelayPreparedNew", w "$RelayPrepared", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not activate its prepared recovery receipt."
    Goto BootstrapFailed
  ${EndIf}
  ${If} $RelayStandaloneUpdate == "1"
    Goto CompleteStandaloneRecoveryUpdate
  ${EndIf}
  Goto ShortcutsReady

CompleteStandaloneRecoveryUpdate:
  ${If} $RelayBannerVisible == "1"
    Banner::destroy
    StrCpy $RelayBannerVisible "0"
  ${EndIf}
  ReadINIStr $RelayRequestCheckpoint "$RelayRequest" "RecoveryRequest" "checkpoint"
  ${If} $RelayRequestCheckpoint == "pending"
    ExecWait '"$RelayFinalRuntime\${APP_EXECUTABLE_FILENAME}" --relay-manual-update-checkpoint /relay-transaction=$RelayTransactionId' $RelayResult
    ${If} $RelayResult != 0
      StrCpy $RelayFailureMessage "Relay could not create its protected rollback checkpoint."
      Goto BootstrapFailed
    ${EndIf}
  ${ElseIf} $RelayRequestCheckpoint != "complete"
    StrCpy $RelayFailureMessage "Relay found an invalid protected rollback checkpoint state."
    Goto BootstrapFailed
  ${EndIf}
  ReadINIStr $RelayRequestProtocol "$RelayRequest" "RecoveryRequest" "protocol"
  ReadINIStr $RelayRequestTransaction "$RelayRequest" "RecoveryRequest" "transactionId"
  ReadINIStr $RelayRequestMode "$RelayRequest" "RecoveryRequest" "mode"
  ReadINIStr $RelayRequestCheckpoint "$RelayRequest" "RecoveryRequest" "checkpoint"
  ReadINIStr $RelayRequestSnapshotId "$RelayRequest" "RecoveryRequest" "snapshotId"
  ${If} $RelayRequestProtocol != "${RELAY_RECOVERY_PROTOCOL}"
  ${OrIf} $RelayRequestTransaction != $RelayTransactionId
  ${OrIf} $RelayRequestCheckpoint != "complete"
    StrCpy $RelayFailureMessage "Relay could not verify its protected rollback checkpoint."
    Goto BootstrapFailed
  ${EndIf}
  ${If} $RelayRequestMode == "server"
    !insertmacro RelayValidateTransactionId "$RelayRequestSnapshotId" $RelayTransactionIsValid
    ${If} $RelayTransactionIsValid != "1"
      StrCpy $RelayFailureMessage "Relay received an invalid protected server snapshot."
      Goto BootstrapFailed
    ${EndIf}
    !insertmacro RelayCompletedServerSnapshotIsUsable $RelayResult
    ${If} $RelayResult != "1"
      StrCpy $RelayFailureMessage "Relay could not verify its protected server snapshot."
      Goto BootstrapFailed
    ${EndIf}
  ${ElseIf} $RelayRequestMode == "client"
  ${OrIf} $RelayRequestMode == "unconfigured"
    ${If} $RelayRequestSnapshotId != ""
      StrCpy $RelayFailureMessage "Relay received an unexpected protected update snapshot."
      Goto BootstrapFailed
    ${EndIf}
  ${Else}
    StrCpy $RelayFailureMessage "Relay received an invalid protected update mode."
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
  WriteINIStr "$RelayRepairResultNew" "RepairResult" "runtimeSha512" "$RelayMarkerHash"
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

  ${If} $RelayAppLockHandle != ""
    System::Call 'kernel32::CloseHandle(p $RelayAppLockHandle)'
    StrCpy $RelayAppLockHandle ""
  ${EndIf}
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
  ${If} $RelayAppLockHandle != ""
  ${AndIf} $RelayAppLockHandle != -1
    System::Call 'kernel32::CloseHandle(p $RelayAppLockHandle)'
    StrCpy $RelayAppLockHandle ""
  ${EndIf}
  Delete "$RelayLauncherNew"
  Delete "$RelayStateNew"
  Delete "$RelayPreparedNew"
  Delete "$RelayRepairResultNew"
  Delete "$RelayRequestNew"
  ${If} $RelayStandaloneUpdate == "1"
    Delete "$RelayRequest"
    Delete "$RelayPrepared"
  ${EndIf}
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
