@echo off
cd /d "%~dp0"
if not defined HERMES_GUARD_AUDIT_DIR set "HERMES_GUARD_AUDIT_DIR=%~dp0audit"
if not exist "%HERMES_GUARD_AUDIT_DIR%" mkdir "%HERMES_GUARD_AUDIT_DIR%"
node "%~dp0hermes_hook_bridge.mjs"
