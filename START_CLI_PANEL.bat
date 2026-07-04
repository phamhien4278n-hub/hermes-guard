@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo Hermes Guard needs Node.js to run.
  echo Please install Node.js LTS from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node "%~dp0cli_panel.mjs"
set "EXIT_CODE=%errorlevel%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Hermes Guard panel exited with code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
