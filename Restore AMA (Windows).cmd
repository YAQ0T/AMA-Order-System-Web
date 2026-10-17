@echo off
REM Double-click to restore the database from a backup. See server\restore-db.js.
setlocal
title AMA Order System - Restore a backup
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo.
  pause
  exit /b 1
)

node scripts\launch.js restore
echo.
pause
