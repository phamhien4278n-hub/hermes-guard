@echo off
cd /d "%~dp0"

echo Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please install Node.js LTS from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node --version
echo.
echo Checking deployment manifest...
node "%~dp0guard.mjs" manifest check --format text
echo.
echo Running Hermes Guard tests...
node --test
echo.
pause
