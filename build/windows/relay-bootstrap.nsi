!include "common.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "StdUtils.nsh"
!include "Win\WinError.nsh"
!include "${PROJECT_DIR}/build/windows/include/relay-runtime-contract.nsh"
!include "${PROJECT_DIR}/release/windows-bootstrap/relay-build.nsh"

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
    StrCpy $RelayResult "0"
    ${If} ${FileExists} "$RelayRuntimeRoot\${BUILD_ID}\${APP_EXECUTABLE_FILENAME}"
      System::Call 'kernel32::GetBinaryTypeW(w "$RelayRuntimeRoot\${BUILD_ID}\${APP_EXECUTABLE_FILENAME}", *i .r0) i.r1'
      StrCpy $RelayResult $1
    ${EndIf}
    ${If} $RelayMarkerProtocol == "${RELAY_STATE_PROTOCOL}"
    ${AndIf} $RelayMarkerBuildId == "${BUILD_ID}"
    ${AndIf} $RelayMarkerExecutable == "${APP_EXECUTABLE_FILENAME}"
    ${AndIf} $RelayResult != "0"
      StrCpy ${RESULT} "1"
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
    ${If} ${FileExists} "$RelayLauncher"
      ${If} $RelayArgs != "/relay-prepare-only"
        Exec '"$RelayLauncher" $RelayArgs'
      ${EndIf}
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
  File /oname=$PLUGINSDIR\${RELAY_LAUNCHER_FILE} "${PROJECT_DIR}/release/windows-bootstrap/${RELAY_LAUNCHER_FILE}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif

  ReadINIStr $RelayResult "$RelayState" "Relay" "protocol"
  ${If} $RelayResult == "${RELAY_STATE_PROTOCOL}"
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
  ${Else}
    StrCpy $RelayCurrent ""
    StrCpy $RelayPrevious ""
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
  ${If} $RelayMarkerProtocol == "${RELAY_STATE_PROTOCOL}"
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
  File /oname=$PLUGINSDIR\relay-app.zip "${APP_64}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif

  ${StdUtils.HashFile} $RelayArchiveHash "SHA2-512" "$PLUGINSDIR\relay-app.zip"
  ${If} $RelayArchiveHash != "${APP_64_HASH}"
    StrCpy $RelayFailureMessage "Relay could not verify the embedded runtime archive."
    Goto BootstrapFailed
  ${EndIf}

  nsisunz::Unzip "$PLUGINSDIR\relay-app.zip" "$RelayStaging"
  Pop $RelayResult
  ${If} $RelayResult != "success"
    StrCpy $RelayFailureMessage "Relay could not extract the new runtime."
    Goto BootstrapFailed
  ${EndIf}
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
  WriteINIStr "$RelayMarker" "Relay" "protocol" "${RELAY_STATE_PROTOCOL}"
  WriteINIStr "$RelayMarker" "Relay" "buildId" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayMarker" "Relay" "executable" "${APP_EXECUTABLE_FILENAME}"
  WriteINIStr "$RelayMarker" "Relay" "payloadHash" "${APP_64_HASH}"
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
  Delete "$RelayStateNew"
  ClearErrors
  WriteINIStr "$RelayStateNew" "Relay" "protocol" "${RELAY_STATE_PROTOCOL}"
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
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not prepare its runtime state."
    Goto BootstrapFailed

  !insertmacro RelayHarnessFail ".fail-before-state-activation" "Relay harness stopped before state activation."

  System::Call 'kernel32::MoveFileExW(w "$RelayStateNew", w "$RelayState", i 9) i.r0'
  ${If} $0 == 0
    StrCpy $RelayFailureMessage "Relay could not activate the prepared build."
    Goto BootstrapFailed
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\Relay"
  ClearErrors
  CreateShortCut "$DESKTOP\Relay.lnk" "$RelayLauncher" "" "$RelayLauncher" 0 SW_SHOWNORMAL "" "Relay"
  CreateShortCut "$SMPROGRAMS\Relay\Relay.lnk" "$RelayLauncher" "" "$RelayLauncher" 0 SW_SHOWNORMAL "" "Relay"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Relay is ready, but Windows could not refresh one of its shortcuts."
  ${EndIf}

  ${If} $RelayBannerVisible == "1"
    Banner::destroy
    StrCpy $RelayBannerVisible "0"
  ${EndIf}

  ${If} $RelayArgs != "/relay-prepare-only"
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
  ${If} $RelayArgs != "/relay-prepare-only"
    MessageBox MB_OK|MB_ICONSTOP "$RelayFailureMessage Relay will try the last usable build."
  ${EndIf}
  ${If} $RelayArgs != "/relay-prepare-only"
  ${AndIf} ${FileExists} "$RelayLauncher"
    Exec '"$RelayLauncher" $RelayArgs'
  ${EndIf}
  SetErrorLevel 1
  Quit
SectionEnd
