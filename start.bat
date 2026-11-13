@echo off
setlocal EnableDelayedExpansion

title Annapurna Link - Local Development Server

echo ========================================
echo   Annapurna Link - Local Setup
echo ========================================
echo.

REM Navigate to the script directory (in case user runs as admin or from elsewhere)
cd /d "%~dp0"

REM ----------------------------------------------------------------------
REM Step 1: Check prerequisites
REM ----------------------------------------------------------------------

echo [1/5] Checking prerequisites...
echo.

REM Check for Node.js
echo  - Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo    ERROR: Node.js is not installed or not in PATH.
    echo    Please install Node.js 22 from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo    Found Node.js %NODE_VER%

REM Check for Docker
echo  - Checking Docker...
docker --version >nul 2>&1
if errorlevel 1 (
    echo    ERROR: Docker is not installed or not running.
    echo    Please install Docker Desktop from https://www.docker.com/products/docker-desktop/
    echo    Make sure Docker Desktop is running and try again.
    echo.
    pause
    exit /b 1
)
echo    Docker is available

REM Check for Docker Compose
echo  - Checking Docker Compose...
docker compose version >nul 2>&1
if errorlevel 1 (
    echo    ERROR: Docker Compose plugin not found.
    echo    Please install Docker Desktop (includes Compose) from https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)
echo    Docker Compose is available
echo.

REM ----------------------------------------------------------------------
REM Step 2: Generate .env if it doesn't exist
REM ----------------------------------------------------------------------

echo [2/5] Setting up environment...
if exist ".env" (
    echo  - .env file already exists, skipping generation.
) else (
    echo  - Generating fresh .env file with local credentials...
    call npm run setup:env
    if errorlevel 1 (
        echo    ERROR: Failed to generate .env file.
        echo    Try running "npm run setup:env" manually and check for errors.
        echo.
        pause
        exit /b 1
    )
    echo    .env created successfully.
)
echo.

REM ----------------------------------------------------------------------
REM Step 3: Check for node_modules and install if needed
REM ----------------------------------------------------------------------

echo [3/5] Checking dependencies...
if exist "node_modules" (
    echo  - node_modules found.
) else (
    echo  - node_modules not found. Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo    ERROR: npm install failed.
        echo    Try running "npm install" manually and check for errors.
        echo.
        pause
        exit /b 1
    )
    echo    Dependencies installed successfully.
)
echo.

REM ----------------------------------------------------------------------
REM Step 4: Start Docker Compose
REM ----------------------------------------------------------------------

echo [4/5] Starting Docker Compose services...
echo  - This may take several minutes on first run (building images, etc.)
echo  - Press Ctrl+C to stop the server
echo.
echo  - Services starting:
echo      * PostgreSQL database
echo      * Web app (Next.js)
echo      * Background worker
echo      * Mailpit (email testing)
echo.

REM Start Docker Compose in detached mode first so we can open the browser
echo Starting containers...
call docker compose up --build -d
if errorlevel 1 (
    echo.
    echo    ERROR: Failed to start Docker Compose services.
    echo    Make sure Docker Desktop is running and try again.
    echo.
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------
REM Step 5: Wait for the app to be ready and open browser
REM ----------------------------------------------------------------------

echo.
echo [5/5] Waiting for application to start...
echo.

set MAX_WAIT=120
set WAITED=0
set READY=0

:wait_loop
if %WAITED% geq %MAX_WAIT% goto wait_timeout

REM Check if the health endpoint responds
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    set READY=1
    goto wait_done
)

REM Wait 2 seconds and try again
timeout /t 2 /nobreak >nul
set /a WAITED+=2
set /a SEC_LEFT=%MAX_WAIT% - %WAITED%
echo    Waiting for app to be ready... (%SEC_LEFT%s remaining)
goto wait_loop

:wait_timeout
echo.
echo    WARNING: Timed out waiting for the app to respond after %MAX_WAIT% seconds.
echo    The app may still be starting up. You can check logs with: docker compose logs -f web
echo.

:wait_done
echo.
echo ========================================
echo   Annapurna Link is running!
echo ========================================
echo.
echo   App URL:    http://localhost:3000
echo   Health:     http://localhost:3000/api/health
echo   Mailpit:    http://localhost:8025 (email testing)
echo.
echo   To stop:    Press any key in this window, or run "docker compose down"
echo.
echo ========================================
echo.

if %READY%==1 (
    echo Opening browser...
    start "" "http://localhost:3000"
)

REM Keep the window open and show logs until user presses a key
echo Tailing logs (web + worker). Press any key to stop the server and exit...
echo.
start /b docker compose logs -f --tail=20 web worker

pause >nul

echo.
echo Stopping services...
call docker compose down
echo Services stopped. Goodbye!
echo.
timeout /t 3 /nobreak >nul
exit /b 0
