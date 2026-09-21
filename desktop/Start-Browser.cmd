@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
if exist "runtime\electron.exe" (
  start "" "runtime\electron.exe" "%~dp0" %*
  exit /b
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "%~dp0" %*
  exit /b
)
echo Electron runtime not found. Run npm install in this directory first.
pause
