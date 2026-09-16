@echo off
if "%~1"=="--help" (
  echo fake-pi-fail help
  exit /b 0
)
echo PI_FAKE_FAILURE 1>&2
exit /b 7
