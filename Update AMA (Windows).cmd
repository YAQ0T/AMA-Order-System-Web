@echo off
REM Double-click to update the AMA Order System to the newest version on GitHub.
REM Your settings (server\.env), backups and logs are kept, a backup of the data
REM is taken first, and a running system is started again. See scripts\launch.js.
REM
REM Everything runs inside one ( ... ) block: cmd reads the whole block before
REM running it, so the update can safely replace this very file.
setlocal
title AMA Order System - Update
cd /d "%~dp0"
(
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   Node.js is not installed on this computer.
    echo   Install the LTS version from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
  )
  node scripts\launch.js update
  echo.
  pause
  exit /b
)
