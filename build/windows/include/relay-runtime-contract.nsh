!ifndef RELAY_RUNTIME_CONTRACT_INCLUDED
!define RELAY_RUNTIME_CONTRACT_INCLUDED

!include "LogicLib.nsh"
!include "WordFunc.nsh"

!define RELAY_LEGACY_STATE_PROTOCOL "1"
!define RELAY_RECOVERY_STATE_PROTOCOL "2"
!define RELAY_STATE_PROTOCOL "2"
!define RELAY_LAUNCHER_PROBE "--relay-launcher-probe"
!define RELAY_LAUNCHER_PROTOCOL_EXIT_CODE 102
!define RELAY_RECOVERY_ARGUMENT "/relay-recovery"
!define RELAY_RECOVERY_CENTER_ARGUMENT "--relay-recovery-center"
!define RELAY_RECOVERY_PROBATION_PREFIX "--relay-recovery-probation="
!define RELAY_REPAIR_ONLY_ARGUMENT "/relay-repair-only"
!define RELAY_RELEASES_URL "https://github.com/CrimsonSoul/Relay/releases"
!define RELAY_INNER_EXECUTABLE "Relay.exe"
!define RELAY_RUNTIME_MARKER ".relay-runtime-ready"
!define RELAY_APP_ASAR "resources\app.asar"
!define RELAY_POCKETBASE_EXECUTABLE "resources\pocketbase\win32-x64\pocketbase.exe"
!define RELAY_BETTER_SQLITE3_NATIVE "resources\app.asar.unpacked\node_modules\better-sqlite3\build\Release\better_sqlite3.node"
!define RELAY_KOFFI_NATIVE "resources\app.asar.unpacked\node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node"
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
Var RelayContractUuidCharacter
Var RelayContractIntegrityExpected
Var RelayContractIntegrityActual
Var RelayContractIntegrityLength
Var RelayContractIntegrityFiltered
Var RelayContractIntegrityFileResult

!macro RelayVerifyRuntimeFile ROOT MARKER KEY RELATIVE_PATH RESULT
  StrCpy ${RESULT} "0"
  ReadINIStr $RelayContractIntegrityExpected "${MARKER}" "Integrity" "${KEY}"
  StrLen $RelayContractIntegrityLength $RelayContractIntegrityExpected
  ${StrFilter} "$RelayContractIntegrityExpected" "" "0123456789abcdef" "" $RelayContractIntegrityFiltered
  ${If} $RelayContractIntegrityLength == 128
  ${AndIf} $RelayContractIntegrityFiltered == $RelayContractIntegrityExpected
  ${AndIf} ${FileExists} "${ROOT}\${RELATIVE_PATH}"
    ${StdUtils.HashFile} $RelayContractIntegrityActual "SHA2-512" "${ROOT}\${RELATIVE_PATH}"
    ${If} $RelayContractIntegrityActual == $RelayContractIntegrityExpected
      StrCpy ${RESULT} "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro RelayVerifyRuntimeContent ROOT MARKER RESULT
  StrCpy ${RESULT} "1"
  !insertmacro RelayVerifyRuntimeFile "${ROOT}" "${MARKER}" "executableSha512" "${RELAY_INNER_EXECUTABLE}" $RelayContractIntegrityFileResult
  ${If} $RelayContractIntegrityFileResult != "1"
    StrCpy ${RESULT} "0"
  ${EndIf}
  !insertmacro RelayVerifyRuntimeFile "${ROOT}" "${MARKER}" "appAsarSha512" "${RELAY_APP_ASAR}" $RelayContractIntegrityFileResult
  ${If} $RelayContractIntegrityFileResult != "1"
    StrCpy ${RESULT} "0"
  ${EndIf}
  !insertmacro RelayVerifyRuntimeFile "${ROOT}" "${MARKER}" "pocketbaseSha512" "${RELAY_POCKETBASE_EXECUTABLE}" $RelayContractIntegrityFileResult
  ${If} $RelayContractIntegrityFileResult != "1"
    StrCpy ${RESULT} "0"
  ${EndIf}
  !insertmacro RelayVerifyRuntimeFile "${ROOT}" "${MARKER}" "betterSqlite3Sha512" "${RELAY_BETTER_SQLITE3_NATIVE}" $RelayContractIntegrityFileResult
  ${If} $RelayContractIntegrityFileResult != "1"
    StrCpy ${RESULT} "0"
  ${EndIf}
  !insertmacro RelayVerifyRuntimeFile "${ROOT}" "${MARKER}" "koffiSha512" "${RELAY_KOFFI_NATIVE}" $RelayContractIntegrityFileResult
  ${If} $RelayContractIntegrityFileResult != "1"
    StrCpy ${RESULT} "0"
  ${EndIf}
!macroend

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

!macro RelayValidateTransactionId VALUE RESULT
  StrCpy ${RESULT} "0"
  StrLen $RelayContractLength "${VALUE}"
  ${If} $RelayContractLength == 36
    ${StrFilter} "${VALUE}" "" "0123456789abcdef-" "" $RelayContractFiltered
    ${If} $RelayContractFiltered == "${VALUE}"
      StrCpy $RelayContractUuidCharacter "${VALUE}" 1 8
      ${If} $RelayContractUuidCharacter == "-"
        StrCpy $RelayContractUuidCharacter "${VALUE}" 1 13
        ${If} $RelayContractUuidCharacter == "-"
          StrCpy $RelayContractUuidCharacter "${VALUE}" 1 18
          ${If} $RelayContractUuidCharacter == "-"
            StrCpy $RelayContractUuidCharacter "${VALUE}" 1 23
            ${If} $RelayContractUuidCharacter == "-"
              StrCpy $RelayContractUuidCharacter "${VALUE}" 1 14
              ${If} $RelayContractUuidCharacter == "4"
                StrCpy $RelayContractUuidCharacter "${VALUE}" 1 19
                ${If} $RelayContractUuidCharacter == "8"
                ${OrIf} $RelayContractUuidCharacter == "9"
                ${OrIf} $RelayContractUuidCharacter == "a"
                ${OrIf} $RelayContractUuidCharacter == "b"
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

!endif
