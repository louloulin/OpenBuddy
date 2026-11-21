@echo off
setlocal
cd /d "%~dp0"
call pnpm dev:electron
if errorlevel 1 pause
endlocal
