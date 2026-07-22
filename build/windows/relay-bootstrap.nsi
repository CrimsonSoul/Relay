!include "common.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "Win\WinError.nsh"
!include "${PROJECT_DIR}/build/windows/include/relay-runtime-contract.nsh"
!include "${PROJECT_DIR}/release/windows-bootstrap/relay-build.nsh"

Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
WindowIcon off
CRCCheck off

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
Var RelayBannerVisible
Var RelayFailureMessage

Function .onInit
  !insertmacro check64BitAndSetRegView
  SetShellVarContext current
  ${GetParameters} $RelayArgs

  System::Call 'kernel32::CreateMutexW(p 0, i 1, w "Local\RelayBootstrapProtocol1") p.r0 ?e'
  Pop $RelayResult
  ${If} $RelayResult == ${ERROR_ALREADY_EXISTS}
    StrCpy $RelayLauncher "$LOCALAPPDATA\Relay\Relay.exe"
    ${If} ${FileExists} "$RelayLauncher"
      ${If} $RelayArgs != "/relay-prepare-only"
        Exec '"$RelayLauncher" $RelayArgs'
      ${EndIf}
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "Relay is already being prepared."
    ${EndIf}
    SetErrorLevel 0
    Quit
  ${EndIf}
FunctionEnd

Section
  InitPluginsDir
  StrCpy $RelayBannerVisible "0"
  StrCpy $RelayRoot "$LOCALAPPDATA\Relay"
  StrCpy $RelayRuntimeRoot "$RelayRoot\Runtime"
  StrCpy $RelayFinalRuntime "$RelayRuntimeRoot\${RELAY_BUILD_ID}"
  StrCpy $RelayState "$RelayRoot\state.ini"
  StrCpy $RelayStateNew "$RelayRoot\state.ini.new"
  StrCpy $RelayLauncher "$LOCALAPPDATA\Relay\Relay.exe"
  StrCpy $RelayLauncherNew "$RelayRoot\Relay.exe.new"

  CreateDirectory "$RelayRuntimeRoot"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not create its local runtime folder."
    Goto BootstrapFailed

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
  ReadINIStr $RelayResult "$RelayMarker" "Relay" "buildId"
  ${If} $RelayResult == "${RELAY_BUILD_ID}"
    ReadINIStr $RelayResult "$RelayMarker" "Relay" "payloadHash"
    ${If} $RelayResult == "${APP_64_HASH}"
    ${AndIf} ${FileExists} "$RelayFinalRuntime\${APP_EXECUTABLE_FILENAME}"
      Goto RuntimeReady
    ${EndIf}
  ${EndIf}

  Banner::show /NOUNLOAD "Preparing Relay..."
  StrCpy $RelayBannerVisible "1"
  System::Call 'kernel32::GetCurrentProcessId() i.r0'
  StrCpy $RelayStaging "$RelayRuntimeRoot\.staging-${RELAY_BUILD_ID}-$0"
  RMDir /r "$RelayStaging"
  CreateDirectory "$RelayStaging"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not create a staging folder."
    Goto BootstrapFailed

  SetOutPath "$PLUGINSDIR"
  !ifdef COMPRESS
    SetCompress off
  !endif
  File /oname=$PLUGINSDIR\relay-app.zip "${APP_64}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif

  nsisunz::Unzip "$PLUGINSDIR\relay-app.zip" "$RelayStaging"
  Pop $RelayResult
  ${If} $RelayResult != "success"
    StrCpy $RelayFailureMessage "Relay could not extract the new runtime."
    Goto BootstrapFailed
  ${EndIf}

  ${IfNot} ${FileExists} "$RelayStaging\${APP_EXECUTABLE_FILENAME}"
    StrCpy $RelayFailureMessage "The prepared Relay runtime is incomplete."
    Goto BootstrapFailed
  ${EndIf}

  StrCpy $RelayMarker "$RelayStaging\${RELAY_RUNTIME_MARKER}"
  ClearErrors
  WriteINIStr "$RelayMarker" "Relay" "protocol" "${RELAY_STATE_PROTOCOL}"
  WriteINIStr "$RelayMarker" "Relay" "buildId" "${RELAY_BUILD_ID}"
  WriteINIStr "$RelayMarker" "Relay" "payloadHash" "${APP_64_HASH}"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not finalize the new runtime."
    Goto BootstrapFailed

  RMDir /r "$RelayFinalRuntime"
  ${If} ${FileExists} "$RelayFinalRuntime"
    StrCpy $RelayFailureMessage "Relay could not replace an incomplete runtime."
    Goto BootstrapFailed
  ${EndIf}

  ClearErrors
  Rename "$RelayStaging" "$RelayFinalRuntime"
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not activate the prepared runtime folder."
    Goto BootstrapFailed

RuntimeReady:
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
  ${If} $RelayCurrent == "${RELAY_BUILD_ID}"
    ${If} $RelayPrevious != ""
      WriteINIStr "$RelayStateNew" "Relay" "previous" "$RelayPrevious"
    ${EndIf}
  ${ElseIf} $RelayCurrent != ""
    WriteINIStr "$RelayStateNew" "Relay" "previous" "$RelayCurrent"
  ${EndIf}
  IfErrors 0 +3
    StrCpy $RelayFailureMessage "Relay could not prepare its runtime state."
    Goto BootstrapFailed

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
  RMDir /r "$RelayStaging"
  Delete "$RelayLauncherNew"
  Delete "$RelayStateNew"
  MessageBox MB_OK|MB_ICONSTOP "$RelayFailureMessage The previous Relay build remains available."
  ${If} $RelayArgs != "/relay-prepare-only"
  ${AndIf} ${FileExists} "$RelayLauncher"
    Exec '"$RelayLauncher" $RelayArgs'
  ${EndIf}
  SetErrorLevel 1
  Quit
SectionEnd
