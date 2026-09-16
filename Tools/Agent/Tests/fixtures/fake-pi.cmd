@echo off
if "%~1"=="--help" (
  echo fake-pi help
  exit /b 0
)
echo PI_FAKE_HANDOFF_READY
exit /b 0
