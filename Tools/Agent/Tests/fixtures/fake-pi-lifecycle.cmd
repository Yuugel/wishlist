@echo off
if "%~1"=="--help" (
  echo fake-pi-lifecycle help
  exit /b 0
)
ping 127.0.0.1 -n 6 >nul
echo {"type":"session","version":3,"id":"lifecycle-fixture"}
echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"LIFECYCLE_FIXTURE_OK"}],"usage":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"total":0}}}}
echo {"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"LIFECYCLE_FIXTURE_OK"}]}]}
exit /b 0
