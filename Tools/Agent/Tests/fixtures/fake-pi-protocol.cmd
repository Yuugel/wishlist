@echo off
if "%~1"=="--help" (
  echo fake-pi-protocol help
  exit /b 0
)

set "CASE=valid"
if /I "%~1"=="--case" set "CASE=%~2"

if /I "%CASE%"=="empty" exit /b 0
if /I "%CASE%"=="no-events" (
  echo(
  exit /b 0
)

if /I "%CASE%"=="no-terminal" (
  echo {"type":"session","version":3,"id":"no-terminal-session","cwd":"."}
  echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"INITIALIZED_ONLY"}]}}
  exit /b 0
)

if /I "%CASE%"=="terminal-no-response" (
  echo {"type":"session","version":3,"id":"terminal-no-response-session","cwd":"."}
  echo {"type":"agent_end","messages":[]}
  exit /b 0
)

if /I "%CASE%"=="malformed" (
  echo {"type":"session","version":3,"id":"malformed-session","cwd":"."}
  echo {not-valid-json
  exit /b 0
)

if /I "%CASE%"=="truncated" (
  echo {"type":"session","version":3,"id":"truncated-session","cwd":"."}
  echo {"type":"agent_end","messages":[
  exit /b 0
)

if /I "%CASE%"=="no-usage" (
  echo {"type":"session","version":3,"id":"no-usage-session","cwd":"."}
  echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"NO_USAGE_VALID"}]}}
  echo {"type":"agent_end","messages":[]}
  exit /b 0
)

if /I "%CASE%"=="zero-usage" (
  echo {"type":"session","version":3,"id":"zero-usage-session","cwd":"."}
  echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ZERO_USAGE_VALID"}],"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"total":0}}}}
  echo {"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"ZERO_USAGE_VALID"}]}]}
  exit /b 0
)

echo {"type":"session","version":3,"id":"valid-protocol-session","cwd":"."}
echo {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"VALID_PROTOCOL_RUN"}],"usage":{"input":12,"output":5,"cacheRead":3,"cacheWrite":1,"totalTokens":21,"cost":{"total":0.034}}}}
echo {"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"VALID_PROTOCOL_RUN"}]}]}
exit /b 0
