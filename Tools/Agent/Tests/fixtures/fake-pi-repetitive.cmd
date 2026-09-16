@echo off
if "%~1"=="--help" (
  echo fake-pi-repetitive help
  exit /b 0
)
if /I not "%~1"=="--case" exit /b 2
if /I not "%~2"=="repetitive" exit /b 2
echo {"type":"session","version":3,"id":"repetitive-session","cwd":"."}
for /L %%N in (1,1,1200) do echo {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":""}}
echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"REPETITIVE_VALID"}]}}
echo {"type":"agent_end","messages":[]}
exit /b 0
