!ifndef RELAY_RUNTIME_CONTRACT_INCLUDED
!define RELAY_RUNTIME_CONTRACT_INCLUDED

!include "LogicLib.nsh"
!include "WordFunc.nsh"

!define RELAY_STATE_PROTOCOL "1"
!define RELAY_LAUNCHER_PROBE "--relay-launcher-probe"
!define RELAY_LAUNCHER_PROTOCOL_EXIT_CODE 101
!define RELAY_INNER_EXECUTABLE "Relay.exe"
!define RELAY_RUNTIME_MARKER ".relay-runtime-ready"
!define RELAY_BUILD_ID_CHARSET "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"

Var RelayContractLength
Var RelayContractFiltered

!macro RelayValidateBuildId VALUE RESULT
  StrCpy ${RESULT} "0"
  StrLen $RelayContractLength "${VALUE}"

  ${If} $RelayContractLength > 64
    StrCpy ${RESULT} "0"
  ${ElseIf} $RelayContractLength >= 1
    ${StrFilter} "${VALUE}" "" "${RELAY_BUILD_ID_CHARSET}" "" $RelayContractFiltered
    ${If} $RelayContractFiltered == "${VALUE}"
      StrCpy ${RESULT} "1"
    ${EndIf}
  ${EndIf}
!macroend

!endif
