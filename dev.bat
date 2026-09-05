@echo off
REM ===========================================================================
REM  OpenBuddy dev launcher (Windows)
REM
REM  Double-click this file to start the OpenBuddy renderer + Electron
REM  dev pipeline. electron-vite orchestrates everything: builds main +
REM  preload in watch mode, starts the Vite dev server, and launches
REM  Electron pointed at the dev server URL.
REM
REM  Equivalent (any shell):    pnpm dev
REM  Equivalent (moon):         pnpm dev
REM  Renderer-only (no Electron): pnpm dev:renderer
REM ===========================================================================

setlocal
cd /d "%~dp0"

where /q pnpm
if errorlevel 1 (
  echo [dev.bat] pnpm not found. Install Node.js LTS and `npm i -g pnpm`.
  pause
  exit /b 1
)

echo [dev.bat] Starting: pnpm dev
echo [dev.bat] (Ctrl+C here, or close the OpenBuddy window, to stop)
echo.

pnpm dev

if errorlevel 1 (
  echo.
  echo [dev.bat] dev pipeline exited with error %ERRORLEVEL%.
  pause
)

endlocal
