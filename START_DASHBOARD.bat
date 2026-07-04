@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Hermes Guard.
  echo Please install Node.js LTS from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:8787"
node "%~dp0dashboard.mjs"
