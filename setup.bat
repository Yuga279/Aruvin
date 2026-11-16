@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================================
REM FILE: setup.bat
REM LOCATION: setup.bat
REM ============================================================================
REM
REM PURPOSE:
REM    Install Aurvin's backend and frontend npm dependencies.
REM
REM ROLE IN PROJECT:
REM    Repeatable Windows checkout setup using each package's lockfile.
REM    Preserves existing node_modules content and local environment files.
REM
REM KEY COMPONENTS:
REM    - Runtime check: require a supported Node.js version and npm.
REM    - Package install: reconcile backend and frontend with their lockfiles.
REM    - Environment setup: copy example files only when local files are absent.
REM ============================================================================

if not exist "backend\package.json" (
  echo setup.bat must be started from the Aurvin checkout.
  goto :error
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node 22.22.3+, 24.15+, or 26+ and try again.
  goto :error
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required. Install a supported Node.js release that includes npm.
  goto :error
)

powershell -NoProfile -Command "$v = [version]((node --version) -replace '^v',''); if (($v.Major -eq 22 -and $v -ge [version]'22.22.3') -or ($v.Major -eq 24 -and $v -ge [version]'24.15.0') -or $v.Major -ge 26) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Aurvin requires Node 22.22.3+, 24.15+, or 26+. Detected:
  node --version
  goto :error
)

echo Installing or reconciling backend packages from package-lock.json...
pushd backend
call npm install
if errorlevel 1 (
  popd
  echo Backend dependency installation failed.
  goto :error
)
popd

echo Installing or reconciling frontend packages from package-lock.json...
pushd frontend
call npm install
if errorlevel 1 (
  popd
  echo Frontend dependency installation failed.
  goto :error
)
popd

if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  if errorlevel 1 (
    echo Could not create backend\.env from its example file.
    goto :error
  )
)
if not exist "frontend\.env" (
  copy "frontend\.env.example" "frontend\.env" >nul
  if errorlevel 1 (
    echo Could not create frontend\.env from its example file.
    goto :error
  )
)

echo Setup complete. Configure infrastructure in backend\.env, start Aurvin, then open Super admin - Manage Aurvin to configure chat and voice.
endlocal
exit /b 0

:error
echo.
echo Setup failed. Review the error above.
pause
endlocal
exit /b 1
