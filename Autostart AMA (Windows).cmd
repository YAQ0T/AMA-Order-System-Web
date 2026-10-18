@echo off
REM Double-click to turn "start the system when I log in" on or off. See scripts\launch.js.
setlocal
title AMA Order System - Start automatically
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo.
  pause
  exit /b 1
)

node scripts\launch.js autostart
echo.
pause
