Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef RELAY_FIXTURE_OUT
  !error "RELAY_FIXTURE_OUT is required"
!endif
!ifndef RELAY_FIXTURE_BUILD_ID
  !error "RELAY_FIXTURE_BUILD_ID is required"
!endif
!ifndef RELAY_FIXTURE_PROBATION_DURATION_MS
  !error "RELAY_FIXTURE_PROBATION_DURATION_MS is required"
!endif

Var RelayFixtureArgs
Var RelayFixtureOption
Var RelayFixtureRecoveryRoot
Var RelayFixtureTransaction
Var RelayFixtureRequestTransaction
Var RelayFixtureRequestCheckpoint
Var RelayFixtureRequestMode

Name "Relay CI Fixture"
OutFile "${RELAY_FIXTURE_OUT}"

Section
  ${GetParameters} $RelayFixtureArgs
  StrCpy $RelayFixtureTransaction ""
  StrCpy $RelayFixtureOption $RelayFixtureArgs 1
  ${If} $RelayFixtureOption == '$\"'
    StrCpy $RelayFixtureOption $RelayFixtureArgs 1 -1
    ${If} $RelayFixtureOption == '$\"'
      StrCpy $RelayFixtureArgs $RelayFixtureArgs -1 1
    ${EndIf}
  ${EndIf}
  StrCpy $RelayFixtureOption $RelayFixtureArgs 52
  ${If} $RelayFixtureOption == "--relay-manual-update-checkpoint /relay-transaction="
    StrCpy $RelayFixtureTransaction $RelayFixtureArgs "" 52
    !ifdef RELAY_FIXTURE_ROOT
      StrCpy $RelayFixtureRecoveryRoot "${RELAY_FIXTURE_ROOT}\Recovery"
    !else
      StrCpy $RelayFixtureRecoveryRoot "$EXEDIR\..\..\Recovery"
    !endif
    ReadINIStr $RelayFixtureRequestTransaction "$RelayFixtureRecoveryRoot\update-request.ini" "RecoveryRequest" "transactionId"
    ReadINIStr $RelayFixtureRequestCheckpoint "$RelayFixtureRecoveryRoot\update-request.ini" "RecoveryRequest" "checkpoint"
    ReadINIStr $RelayFixtureRequestMode "$RelayFixtureRecoveryRoot\update-request.ini" "RecoveryRequest" "mode"
    ${If} $RelayFixtureTransaction == ""
    ${OrIf} $RelayFixtureRequestTransaction != $RelayFixtureTransaction
    ${OrIf} $RelayFixtureRequestCheckpoint != "pending"
    ${OrIf} $RelayFixtureRequestMode != "unconfigured"
      SetErrorLevel 1
      Quit
    ${EndIf}
    ClearErrors
    WriteINIStr "$RelayFixtureRecoveryRoot\update-request.ini" "RecoveryRequest" "mode" "unconfigured"
    WriteINIStr "$RelayFixtureRecoveryRoot\update-request.ini" "RecoveryRequest" "checkpoint" "complete"
    WriteINIStr "$RelayFixtureRecoveryRoot\update-request.ini" "RecoveryRequest" "snapshotId" ""
    ${If} ${Errors}
      SetErrorLevel 1
      Quit
    ${EndIf}
    SetErrorLevel 0
    Quit
  ${EndIf}
  StrCpy $RelayFixtureOption $RelayFixtureArgs 27
  ${If} $RelayFixtureOption == "--relay-recovery-probation="
    StrCpy $RelayFixtureTransaction $RelayFixtureArgs "" 27
  ${EndIf}
  ${If} $RelayFixtureTransaction != ""
    !ifdef RELAY_FIXTURE_ROOT
      StrCpy $RelayFixtureRecoveryRoot "${RELAY_FIXTURE_ROOT}\Recovery"
    !else
      StrCpy $RelayFixtureRecoveryRoot "$EXEDIR\..\..\Recovery"
    !endif
    CreateDirectory "$RelayFixtureRecoveryRoot"
    ClearErrors
    WriteINIStr "$RelayFixtureRecoveryRoot\probation-result.ini" "Probation" "protocol" "2"
    WriteINIStr "$RelayFixtureRecoveryRoot\probation-result.ini" "Probation" "transactionId" "$RelayFixtureTransaction"
    WriteINIStr "$RelayFixtureRecoveryRoot\probation-result.ini" "Probation" "buildId" "${RELAY_FIXTURE_BUILD_ID}"
    WriteINIStr "$RelayFixtureRecoveryRoot\probation-result.ini" "Probation" "status" "healthy"
    WriteINIStr "$RelayFixtureRecoveryRoot\probation-result.ini" "Probation" "durationMs" "${RELAY_FIXTURE_PROBATION_DURATION_MS}"
    ${If} ${Errors}
      SetErrorLevel 1
      Quit
    ${EndIf}
    SetErrorLevel 0
    Quit
  ${EndIf}

  ReadEnvStr $0 "RELAY_BENCHMARK_RUN_ID"
  ${If} $0 != ""
    ReadEnvStr $1 "TEMP"
    ${If} $1 != ""
      CreateDirectory "$1\Relay"
      CreateDirectory "$1\Relay\startup-benchmark"
      ClearErrors
      FileOpen $2 "$1\Relay\startup-benchmark\$0.complete" w
      ${IfNot} ${Errors}
        FileWrite $2 "${RELAY_FIXTURE_BUILD_ID}"
        FileClose $2
      ${EndIf}
    ${EndIf}
  ${EndIf}
  SetErrorLevel 0
SectionEnd
