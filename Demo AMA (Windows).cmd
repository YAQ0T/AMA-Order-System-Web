@echo off
REM Double-click: a DEMO copy of the system to try things on - its own database,
REM port 6060, Telegram off, sample accounts and orders. The real system and its
REM data are not touched. It runs while this window is open; close it to stop.
REM See scripts\launch.js (demo).
setlocal
title AMA Order System - DEMO (close this window to stop it)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node scripts\launch.js demo
echo.
pause
