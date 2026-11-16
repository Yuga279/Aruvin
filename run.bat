@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================================
REM FILE: run.bat
REM LOCATION: run.bat
REM ============================================================================
REM
REM PURPOSE:
REM    Start the local Aurvin app and open it in a browser.
REM
REM ROLE IN PROJECT:
REM    Convenience launcher for the checkout. Backend binds 127.0.0.1:8001;
REM    Vite serves 127.0.0.1:5179 and proxies /api to that backend.
REM
REM KEY COMPONENTS:
REM    - Backend window: nest start --watch with PORT=8001
REM    - Liveness gate: Wait for backend liveness before starting Vite
REM    - Frontend window: Vite --port 5179 --host 127.0.0.1
REM    - Browser: http://127.0.0.1:5179 after the UI port responds
REM ============================================================================

set "FRONTEND_PORT=5179"
set "BACKEND_PORT=8001"
set "FRONTEND_ORIGIN=http://127.0.0.1:5179"
set "BACKEND_PROXY_TARGET=http://127.0.0.1:8001"
REM AURVIN_LOCAL_CRASH_RECOVERY is inherited or loaded from backend\.env, never enabled here.
REM Opt-in recovers only proven stopped local owners with an idle durable mutation journal.

if not exist "backend\package.json" (
  echo run.bat must be started from the Aurvin checkout root.
  exit /b 1
)

if not exist "backend\node_modules\" (
  echo Installing backend dependencies...
  pushd backend
  call npm ci
  if errorlevel 1 (
    popd
    echo Backend npm ci failed.
    exit /b 1
  )
  popd
)

if not exist "frontend\node_modules\" (
  echo Installing frontend dependencies...
  pushd frontend
  call npm ci
  if errorlevel 1 (
    popd
    echo Frontend npm ci failed.
    exit /b 1
  )
  popd
)

if not exist "backend\.env" copy /y "backend\.env.example" "backend\.env" >nul
if not exist "frontend\.env" copy /y "frontend\.env.example" "frontend\.env" >nul

echo Building backend...
pushd backend
call npm run build
if errorlevel 1 (
  popd
  echo Backend build failed.
  exit /b 1
)
popd

echo Starting backend on 127.0.0.1:%BACKEND_PORT% ...
echo The launch waits for backend liveness, not configured chat. If readiness stays 503, open Super admin - Manage Aurvin to configure settings; the dashboard remains usable while chat is unconfigured.
start "Aurvin backend" /D "%~dp0backend" cmd /k "set PORT=%BACKEND_PORT%&& set FRONTEND_ORIGIN=%FRONTEND_ORIGIN%&& npm run start:dev"

echo Waiting for backend liveness on 127.0.0.1:%BACKEND_PORT% ...
powershell -NoProfile -Command "for ($i=0; $i -lt 90; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%BACKEND_PORT%/api/operations/live' -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo Backend did not respond to liveness within 90 seconds.
  echo Check the Aurvin backend window for startup errors, then run run.bat again.
  exit /b 1
)

echo Starting frontend on 127.0.0.1:%FRONTEND_PORT% ...
start "Aurvin frontend" /D "%~dp0frontend" cmd /k "set FRONTEND_PORT=%FRONTEND_PORT%&& set BACKEND_PROXY_TARGET=%BACKEND_PROXY_TARGET%&& npm run dev -- --host 127.0.0.1 --port %FRONTEND_PORT% --strictPort"

echo Waiting for http://127.0.0.1:%FRONTEND_PORT% ...
powershell -NoProfile -Command "for ($i=0; $i -lt 45; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%FRONTEND_PORT%' -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; Write-Host 'Frontend did not become ready in time; opening the browser anyway.'"

echo Opening http://127.0.0.1:%FRONTEND_PORT%
start "" "http://127.0.0.1:%FRONTEND_PORT%"
endlocal
