@echo off
setlocal
cd /d "%~dp0"
title Annapurna Link - Local Development

echo Annapurna Link local development - real operations are disabled.
echo First startup downloads dependencies and prepares a local database.
echo Node.js 22 and an internet connection are required on first startup.
echo.
where node >nul 2>&1 || (echo Install Node.js 22 from https://nodejs.org/ first. & pause & exit /b 1)
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
if errorlevel 1 (echo Node.js version 22 is required. & pause & exit /b 1)
where npm >nul 2>&1 || (echo npm was not found. Reinstall Node.js 22 with npm. & pause & exit /b 1)
node scripts/ensure-dependencies.mjs
if errorlevel 1 (echo Dependency installation failed. & pause & exit /b 1)
echo.
echo Starting the app, worker, private test inbox and local database.
echo Open http://localhost:3000 once the server is ready. Press Ctrl+C to stop.
echo.
node scripts/windows-start.mjs
if errorlevel 1 (
  echo.
  echo Startup failed. Check the error above and follow the README setup steps.
  pause
  exit /b 1
)
endlocal
