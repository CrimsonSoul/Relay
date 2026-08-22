Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!include "LogicLib.nsh"

!ifndef RELAY_FIXTURE_OUT
  !error "RELAY_FIXTURE_OUT is required"
!endif

Name "Relay CI Fixture"
OutFile "${RELAY_FIXTURE_OUT}"

Section
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
