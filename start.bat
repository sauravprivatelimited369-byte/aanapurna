@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Annapurna Link - Local Development
set "EXITCODE=0"

echo.
echo   Annapurna Link - local development
echo   Real food operations and real email stay DISABLED.
echo   Everything runs on this computer only.
echo.

where node >nul 2>&1
if errorlevel 1 goto :no_node
where npm >nul 2>&1
if errorlevel 1 goto :no_npm

if not exist "scripts\launch-setup.mjs" goto :no_repo
node "scripts\launch-setup.mjs" %*
set "EXITCODE=%ERRORLEVEL%"
if "%EXITCODE%"=="0" goto :finished

echo.
echo   The launcher stopped with exit code %EXITCODE%. Read the message above.
echo   Your local data in .local-data and your .env file were not deleted.
echo.
pause
exit /b %EXITCODE%

:finished
echo.
echo   Annapurna Link has stopped. Run start.bat again to restart it.
echo.
exit /b 0

:no_node
echo   [MISS] Node.js was not found on this computer.
echo          Annapurna Link needs Node.js 22 LTS, which includes npm.
echo.
echo   This window can open the official download page in your browser.
echo   No software is installed automatically; you stay in control.
echo.
set "OPEN_PAGE="
set /p "OPEN_PAGE=   Open https://nodejs.org/en/download now? [y/N] "
if /i "%OPEN_PAGE%"=="y" goto :open_node
if /i "%OPEN_PAGE%"=="yes" goto :open_node
if /i "%OPEN_PAGE%"=="1" goto :open_node
echo.
echo   No changes were made.
echo   Install Node.js 22 LTS (the default installer includes npm) from:
echo     https://nodejs.org/en/download
echo   Then double-click start.bat again.
echo.
pause
exit /b 1

:open_node
start "" "https://nodejs.org/en/download"
echo.
echo   The download page was opened. Install Node.js 22 LTS with the default
echo   options, then double-click start.bat again. No other changes were made.
echo.
pause
exit /b 1

:no_repo
echo   [MISS] scripts\launch-setup.mjs was not found next to start.bat.
echo          Run start.bat from the repository folder you cloned
echo          (the folder that contains package.json and the scripts folder).
echo.
echo   No changes were made.
echo.
pause
exit /b 1

:no_npm
echo   [MISS] npm was not found, although Node.js is installed.
echo          Reinstall Node.js 22 LTS with the default options (npm included):
echo            https://nodejs.org/en/download
echo.
echo   No changes were made.
echo.
pause
exit /b 1
