@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)

echo [1/3] Synthetic pre_llm_call through hermes_hook_bridge.mjs
echo {"hook_event_name":"pre_llm_call","session_id":"standalone-bridge","extra":{"user_message":"Please verify MMLU-Pro 92.3%%","conversation_history":[],"is_first_turn":false}} | node "%~dp0hermes_hook_bridge.mjs"
echo.
echo.

echo [2/3] Synthetic transform_llm_output through hermes_hook_bridge.mjs
echo {"hook_event_name":"transform_llm_output","session_id":"standalone-bridge","extra":{"response_text":"MMLU-Pro 92.3%%."}} | node "%~dp0hermes_hook_bridge.mjs"
echo.
echo.

echo [3/3] Sessions list
node "%~dp0guard.mjs" sessions list --format json
echo.
pause
