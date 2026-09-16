@echo off
if "%~1"=="--help" (
  echo fake-pi-json help
  exit /b 0
)
if "%~1"=="--mode" if "%~2"=="json" goto json
echo PI_FAKE_HANDOFF_READY
exit /b 0

:json
echo {"type":"session","version":3,"id":"fixture-session","cwd":"."}
echo {"type":"message_update","usage":{"input":12,"output":5,"cacheRead":3,"cacheWrite":1,"totalTokens":21,"cost":{"input":0.01,"output":0.02,"cacheRead":0.003,"cacheWrite":0.001,"total":0.034}},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"PI_FAKE_JSON_READY"}}
echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"PI_FAKE_JSON_READY"}],"usage":{"input":12,"output":5,"cacheRead":3,"cacheWrite":1,"totalTokens":21,"cost":{"input":0.01,"output":0.02,"cacheRead":0.003,"cacheWrite":0.001,"total":0.034}}}}
echo {"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"PI_FAKE_JSON_READY"}]}]}
exit /b 0
