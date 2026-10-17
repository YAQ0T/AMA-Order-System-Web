@echo off
REM Double-click to stop the AMA Order System. See scripts\launch.js.
setlocal
title AMA Order System - Stop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo.
  pause
  exit /b 1
)

node scripts\launch.js stop
echo.
pause
