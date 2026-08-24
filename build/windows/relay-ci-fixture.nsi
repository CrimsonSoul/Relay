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
Var RelayFixtureRecoveryRoot
Var RelayFixtureTransaction

Name "Relay CI Fixture"
OutFile "${RELAY_FIXTURE_OUT}"

Section
  ${GetParameters} $RelayFixtureArgs
  StrCpy $RelayFixtureTransaction ""
  ${GetOptions} "$RelayFixtureArgs" "--relay-recovery-probation=" $RelayFixtureTransaction
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
        FileWrite $2 "complete"
        FileClose $2
      ${EndIf}
    ${EndIf}
  ${EndIf}
  SetErrorLevel 0
SectionEnd
