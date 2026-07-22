Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
WindowIcon off

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "include\relay-runtime-contract.nsh"

!ifndef RELAY_LAUNCHER_OUT
  !error "RELAY_LAUNCHER_OUT is required"
!endif

!ifndef RELAY_LAUNCHER_ICON
  !error "RELAY_LAUNCHER_ICON is required"
!endif

Name "Relay"
OutFile "${RELAY_LAUNCHER_OUT}"
Icon "${RELAY_LAUNCHER_ICON}"
BrandingText "Relay"
VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Relay"
VIAddVersionKey /LANG=1033 "FileDescription" "Relay Launcher"
VIAddVersionKey /LANG=1033 "FileVersion" "1.0.0.0"
VIAddVersionKey /LANG=1033 "ProductVersion" "1.0.0.0"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright Relay Team"

Var RelayArgs
Var RelayProtocol
Var RelayBuildId
Var RelayBuildIsValid
Var RelayRuntimeDir
Var RelayExecutable
Var RelayMarker

!macro RelayTryRuntime BUILD_ID
  !insertmacro RelayValidateBuildId "${BUILD_ID}" $RelayBuildIsValid
  ${If} $RelayBuildIsValid == "1"
    StrCpy $RelayRuntimeDir "$LOCALAPPDATA\Relay\Runtime\${BUILD_ID}"
    StrCpy $RelayExecutable "$LOCALAPPDATA\Relay\Runtime\$RelayBuildId\${RELAY_INNER_EXECUTABLE}"
    StrCpy $RelayMarker "$RelayRuntimeDir\${RELAY_RUNTIME_MARKER}"

    ${If} ${FileExists} "$RelayMarker"
    ${AndIf} ${FileExists} "$RelayExecutable"
      SetOutPath "$RelayRuntimeDir"
      ClearErrors
      Exec '"$RelayExecutable" $RelayArgs'
      ${IfNot} ${Errors}
        SetErrorLevel 0
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

Section
  ${GetParameters} $RelayArgs
  ${If} $RelayArgs == "${RELAY_LAUNCHER_PROBE}"
    SetErrorLevel ${RELAY_LAUNCHER_PROTOCOL_EXIT_CODE}
    Quit
  ${EndIf}

  ReadINIStr $RelayProtocol "$LOCALAPPDATA\Relay\state.ini" "Relay" "protocol"
  ${If} $RelayProtocol == "${RELAY_STATE_PROTOCOL}"
    ReadINIStr $RelayBuildId "$LOCALAPPDATA\Relay\state.ini" "Relay" "current"
    !insertmacro RelayTryRuntime $RelayBuildId

    ReadINIStr $RelayBuildId "$LOCALAPPDATA\Relay\state.ini" "Relay" "previous"
    !insertmacro RelayTryRuntime $RelayBuildId
  ${EndIf}

  MessageBox MB_OK|MB_ICONEXCLAMATION "Relay needs to be prepared again. Run the downloaded Relay.exe to repair it."
  SetErrorLevel 1
SectionEnd
