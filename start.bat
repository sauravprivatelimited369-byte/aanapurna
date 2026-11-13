@echo off
setlocal
cd /d "%~dp0"
title Annapurna Link - Local Development

echo Annapurna Link local development (Docker is optional)
echo This starts the app, local email sink and worker. PostgreSQL must already
echo be installed, running, and initialized as described in README.md.
echo.
where node >nul 2>&1 || (echo Install Node.js 22 first. & pause & exit /b 1)
if not exist ".env" (
  echo Missing .env. Follow "Local setup without Docker" in README.md first.
  pause
  exit /b 1
)
if not exist "node_modules\next" (
  echo Installing locked dependencies...
  call npm ci
  if errorlevel 1 (echo Dependency installation failed. & pause & exit /b 1)
)
echo Opening http://localhost:3000 after the server is ready is your choice.
echo Press Ctrl+C to stop the app, worker and email sink.
echo.
call npm run local:start
if errorlevel 1 (
  echo.
  echo Startup failed. Check the error above and follow the README setup steps.
  pause
  exit /b 1
)
endlocal
