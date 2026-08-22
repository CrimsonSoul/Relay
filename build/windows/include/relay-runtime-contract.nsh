!ifndef RELAY_RUNTIME_CONTRACT_INCLUDED
!define RELAY_RUNTIME_CONTRACT_INCLUDED

!include "LogicLib.nsh"
!include "WordFunc.nsh"

!define RELAY_STATE_PROTOCOL "1"
!define RELAY_LAUNCHER_PROBE "--relay-launcher-probe"
!define RELAY_LAUNCHER_PROTOCOL_EXIT_CODE 101
!define RELAY_INNER_EXECUTABLE "Relay.exe"
!define RELAY_RUNTIME_MARKER ".relay-runtime-ready"
!define RELAY_BUILD_ID_FIRST_CHARSET "abcdefghijklmnopqrstuvwxyz0123456789"
!define RELAY_BUILD_ID_CHARSET "abcdefghijklmnopqrstuvwxyz0123456789._-"

Var RelayContractLength
Var RelayContractFirst
Var RelayContractFirstFiltered
Var RelayContractLast
Var RelayContractFiltered
Var RelayContractBase
Var RelayContractBaseLength
Var RelayContractDevicePrefix
Var RelayContractDeviceSuffix

!macro RelayValidateBuildId VALUE RESULT
  StrCpy ${RESULT} "0"
  StrLen $RelayContractLength "${VALUE}"

  ${If} $RelayContractLength > 64
    StrCpy ${RESULT} "0"
  ${ElseIf} $RelayContractLength >= 1
    StrCpy $RelayContractFirst "${VALUE}" 1
    ${StrFilter} "$RelayContractFirst" "" "${RELAY_BUILD_ID_FIRST_CHARSET}" "" $RelayContractFirstFiltered
    ${If} $RelayContractFirstFiltered == $RelayContractFirst
      ${StrFilter} "${VALUE}" "" "${RELAY_BUILD_ID_CHARSET}" "" $RelayContractFiltered
      ${If} $RelayContractFiltered == "${VALUE}"
        StrCpy $RelayContractLast "${VALUE}" 1 -1
        ${If} $RelayContractLast != "."
          ${WordFind} "${VALUE}" "." "+1" $RelayContractBase
          ${If} $RelayContractBase == "1"
            StrCpy $RelayContractBase "${VALUE}"
          ${EndIf}
          StrCpy ${RESULT} "1"
          ${If} $RelayContractBase == "con"
          ${OrIf} $RelayContractBase == "prn"
          ${OrIf} $RelayContractBase == "aux"
          ${OrIf} $RelayContractBase == "nul"
            StrCpy ${RESULT} "0"
          ${Else}
            StrLen $RelayContractBaseLength $RelayContractBase
            ${If} $RelayContractBaseLength == 4
              StrCpy $RelayContractDevicePrefix $RelayContractBase 3
              StrCpy $RelayContractDeviceSuffix $RelayContractBase 1 3
              ${If} $RelayContractDevicePrefix == "com"
              ${OrIf} $RelayContractDevicePrefix == "lpt"
                ${If} $RelayContractDeviceSuffix == "1"
                ${OrIf} $RelayContractDeviceSuffix == "2"
                ${OrIf} $RelayContractDeviceSuffix == "3"
                ${OrIf} $RelayContractDeviceSuffix == "4"
                ${OrIf} $RelayContractDeviceSuffix == "5"
                ${OrIf} $RelayContractDeviceSuffix == "6"
                ${OrIf} $RelayContractDeviceSuffix == "7"
                ${OrIf} $RelayContractDeviceSuffix == "8"
                ${OrIf} $RelayContractDeviceSuffix == "9"
                  StrCpy ${RESULT} "0"
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!endif
